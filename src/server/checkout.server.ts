// @ts-nocheck
// Shared Stripe checkout engine (user-attributed pricing workflow).
//
// Callers: the operator RPC fns in src/lib/stripe.functions.ts, and the
// storefront REST route (api/public/storefront/checkout) that powers the
// customer-facing pricing page on the Aurixa Systems website. Mission Control
// is the headless billing engine — the customer never needs its UI.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getStripe } from "@/server/stripe.server";
import { ensureTenant } from "@/server/clone-api-keys.server";
import {
  attributionMetadata,
  consumeHandoff,
  loadValidHandoff,
  recordPurchaseInitiated,
} from "@/server/purchases.server";
import { intentAllows } from "@/server/billing-handoffs.server";
import type { OriginAttribution } from "@/server/purchases.server";

export type CheckoutMode = "topup" | "seat_plan" | "setup_package";

type CatalogItem = {
  id: string;
  slug: string;
  name: string;
  stripe_price_id: string | null;
  currency: string;
  is_active: boolean;
};

export async function resolveItem(mode: CheckoutMode, itemId: string): Promise<CatalogItem | null> {
  const cols = "id, slug, name, stripe_price_id, currency, is_active";
  const query =
    mode === "topup"
      ? supabaseAdmin.from("topup_packs").select(cols).eq("id", itemId).maybeSingle()
      : mode === "seat_plan"
        ? supabaseAdmin.from("seat_plans").select(cols).eq("id", itemId).maybeSingle()
        : supabaseAdmin.from("setup_packages").select(cols).eq("id", itemId).maybeSingle();
  const { data } = await query;
  return (data as CatalogItem | null) ?? null;
}

export async function ensureStripeCustomer(tenantId: string): Promise<string> {
  const { data: tenant } = await supabaseAdmin
    .from("tenants")
    .select("id, display_name, external_ref, stripe_customer_id")
    .eq("id", tenantId)
    .maybeSingle();
  if (!tenant) throw new Error("tenant_not_found");
  if (tenant.stripe_customer_id) return tenant.stripe_customer_id;

  const customer = await getStripe().customers.create({
    name: tenant.display_name ?? tenant.external_ref ?? `tenant_${tenantId.slice(0, 8)}`,
    metadata: { tenant_id: tenantId, external_ref: tenant.external_ref ?? "" },
  });
  await supabaseAdmin
    .from("tenants")
    .update({ stripe_customer_id: customer.id })
    .eq("id", tenantId);
  return customer.id;
}

export type CheckoutCoreArgs = {
  mode: CheckoutMode;
  itemId: string;
  quantity: number;
  cloneId: string | null;
  tenantId?: string;
  /** Absolute URL; must contain the {CHECKOUT_SESSION_ID} placeholder. */
  successUrl: string;
  /** Absolute URL. */
  cancelUrl: string;
  attribution: OriginAttribution;
  /** Single-use handoff to burn once a session exists. */
  handoffToConsume?: string | null;
};

/**
 * Shared checkout core. Callers are responsible for authorisation and for
 * resolving attribution; everything from catalog lookup to the purchases
 * bookkeeping lives here.
 */
export async function startCheckoutCore(args: CheckoutCoreArgs) {
  const item = await resolveItem(args.mode, args.itemId);
  if (!item) return { ok: false as const, error: "item_not_found" };
  if (!item.is_active) return { ok: false as const, error: "item_inactive" };
  if (!item.stripe_price_id) return { ok: false as const, error: "stripe_price_not_linked" };

  // Topups + setup packages need a tenant. If a cloneId is supplied without
  // an explicit tenantId, auto-resolve (or provision) the clone's primary
  // tenant so the pricing page can be fully client-centric.
  const cloneId = args.cloneId;
  let tenantId = args.tenantId;
  if ((args.mode === "topup" || args.mode === "setup_package") && !tenantId) {
    if (!cloneId) return { ok: false as const, error: "tenant_or_clone_required" };
    // Look up clone display name for nicer Stripe customer naming.
    const { data: clone } = await supabaseAdmin
      .from("clones")
      .select("id, name, slug")
      .eq("id", cloneId)
      .maybeSingle();
    if (!clone) return { ok: false as const, error: "clone_not_found" };
    const ensured = await ensureTenant(clone.id, `clone:${clone.slug ?? clone.id}`, clone.name);
    if (!ensured.ok) return { ok: false as const, error: ensured.error };
    tenantId = ensured.tenantId;
  }

  let customerId: string | undefined;
  if (tenantId) customerId = await ensureStripeCustomer(tenantId);

  const sharedMeta = {
    mode: args.mode,
    item_id: args.itemId,
    item_slug: item.slug,
    tenant_id: tenantId ?? "",
    clone_id: cloneId ?? "",
    quantity: String(args.quantity),
    // Attribution contract fields — propagate to the webhook via Stripe so
    // the purchases ledger knows who initiated this checkout, from where.
    ...attributionMetadata(args.attribution),
  };

  const session = await getStripe().checkout.sessions.create({
    mode: args.mode === "seat_plan" ? "subscription" : "payment",
    customer: customerId,
    line_items: [{ price: item.stripe_price_id, quantity: args.quantity }],
    success_url: args.successUrl,
    cancel_url: args.cancelUrl,
    allow_promotion_codes: true,
    automatic_tax: { enabled: true },
    metadata: sharedMeta,
    // Propagate metadata onto the Subscription so that subsequent
    // subscription.* / invoice.* webhook events carry tenant/clone context.
    ...(args.mode === "seat_plan"
      ? { subscription_data: { metadata: sharedMeta } }
      : { payment_intent_data: { metadata: sharedMeta } }),
  });

  // Attribution bookkeeping. Best-effort insert (never blocks checkout);
  // the handoff is single-use, so burn it now that a session exists.
  await recordPurchaseInitiated({
    sessionId: session.id,
    mode: args.mode,
    itemId: args.itemId,
    itemSlug: item.slug,
    quantity: args.quantity,
    cloneId,
    tenantId: tenantId ?? null,
    attribution: args.attribution,
  });
  if (args.handoffToConsume) await consumeHandoff(args.handoffToConsume);

  return { ok: true as const, url: session.url, sessionId: session.id };
}

export type HandoffCheckoutInput = {
  handoffId: string;
  mode: CheckoutMode;
  itemId: string;
  quantity: number;
  /** Absolute URLs for the post-checkout redirect (storefront pages). */
  successUrl: string;
  cancelUrl: string;
};

/**
 * Handoff-scoped checkout: the single-use, expiring, server-minted token IS
 * the credential. Scope (clone/tenant) comes strictly from the handoff, the
 * purchasable item is restricted by its intent, and the token is burned the
 * moment a Stripe session exists. Shared by the RPC fn and the storefront
 * REST endpoint.
 */
export async function startHandoffCheckout(input: HandoffCheckoutInput) {
  const handoff = await loadValidHandoff(input.handoffId);
  if (!handoff) return { ok: false as const, error: "handoff_invalid" };
  if (!intentAllows(handoff.intent, input.mode, input.itemId)) {
    return { ok: false as const, error: "handoff_intent_mismatch" };
  }

  return await startCheckoutCore({
    mode: input.mode,
    itemId: input.itemId,
    quantity: input.quantity,
    // Scope comes strictly from the handoff — input cannot redirect the
    // purchase onto another clone or tenant.
    cloneId: handoff.clone_id,
    tenantId: handoff.tenant_id ?? undefined,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
    attribution: {
      originUserId: handoff.origin_user_id,
      originUsername: handoff.origin_username,
      originSource: handoff.origin_source,
      handoffId: handoff.id,
    },
    handoffToConsume: handoff.id,
  });
}
