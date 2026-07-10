// @ts-nocheck
// Stripe Checkout server functions.
// Creates Stripe Checkout Sessions for top-up packs, seat plans, and setup packages.
// The webhook (api/public/stripe/webhook) finalises the purchase server-side.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOperator } from "@/integrations/supabase/role-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getStripe } from "@/server/stripe.server";
import { ensureTenant } from "@/server/clone-api-keys.server";
import { getRequestHost } from "@tanstack/react-start/server";
import {
  OPERATOR_SOURCE,
  attributionMetadata,
  consumeHandoff,
  loadValidHandoff,
  operatorDisplayName,
  recordPurchaseInitiated,
} from "@/server/purchases.server";
import { intentAllows } from "@/server/billing-handoffs.server";
import type { OriginAttribution } from "@/server/purchases.server";

type Mode = "topup" | "seat_plan" | "setup_package";

const InputSchema = z.object({
  mode: z.enum(["topup", "seat_plan", "setup_package"]),
  tenantId: z.string().uuid().optional(),
  cloneId: z.string().uuid().nullable().optional(),
  itemId: z.string().uuid(),
  quantity: z.number().int().min(1).max(100).default(1),
  successPath: z.string().startsWith("/").default("/billing/success"),
  cancelPath: z.string().startsWith("/").default("/billing/cancel"),
  // Server-minted single-use token that pins the originating clone user
  // (user-attributed pricing workflow; docs/user-tracking-pricing-workflow-plan.md).
  handoffId: z.string().uuid().optional(),
});

type CatalogItem = {
  id: string;
  slug: string;
  name: string;
  stripe_price_id: string | null;
  currency: string;
  is_active: boolean;
};

async function resolveItem(mode: Mode, itemId: string): Promise<CatalogItem | null> {
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

async function ensureStripeCustomer(tenantId: string): Promise<string> {
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

type CheckoutCoreArgs = {
  mode: Mode;
  itemId: string;
  quantity: number;
  cloneId: string | null;
  tenantId?: string;
  successPath: string;
  cancelPath: string;
  attribution: OriginAttribution;
  /** Single-use handoff to burn once a session exists. */
  handoffToConsume?: string | null;
};

/**
 * Shared checkout core used by both the operator server fn and the
 * handoff-scoped (no-login) server fn. Callers are responsible for
 * authorisation and for resolving attribution; everything from catalog
 * lookup to the purchases bookkeeping lives here.
 */
async function startCheckoutCore(args: CheckoutCoreArgs) {
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

  const host = getRequestHost();
  const proto = host.startsWith("localhost") ? "http" : "https";
  const origin = `${proto}://${host}`;
  const successSep = args.successPath.includes("?") ? "&" : "?";

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
    success_url: `${origin}${args.successPath}${successSep}session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}${args.cancelPath}`,
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

export const createStripeCheckout = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    // Resolve who initiated this purchase. A handoff token (minted server-to-
    // server under a clone API key) pins the originating clone user; otherwise
    // the purchase is attributed to the signed-in Mission Control operator.
    const handoff = data.handoffId ? await loadValidHandoff(data.handoffId) : null;
    if (data.handoffId && !handoff) {
      return { ok: false as const, error: "handoff_invalid" };
    }
    if (handoff?.clone_id && data.cloneId && handoff.clone_id !== data.cloneId) {
      return { ok: false as const, error: "handoff_clone_mismatch" };
    }
    const attribution = handoff
      ? {
          originUserId: handoff.origin_user_id,
          originUsername: handoff.origin_username,
          originSource: handoff.origin_source,
          handoffId: handoff.id,
        }
      : {
          originUserId: context.userId as string,
          originUsername: await operatorDisplayName(
            context.userId as string,
            (context.claims as { email?: string } | undefined)?.email ?? null,
          ),
          originSource: OPERATOR_SOURCE,
          handoffId: null,
        };

    // Scope defaults come from the handoff when the caller didn't specify —
    // a handoff-initiated purchase always lands on the clone/tenant it was
    // minted for.
    return await startCheckoutCore({
      mode: data.mode,
      itemId: data.itemId,
      quantity: data.quantity,
      cloneId: data.cloneId ?? handoff?.clone_id ?? null,
      tenantId: data.tenantId ?? handoff?.tenant_id ?? undefined,
      successPath: data.successPath,
      cancelPath: data.cancelPath,
      attribution,
      handoffToConsume: handoff?.id ?? null,
    });
  });

const HandoffCheckoutSchema = z.object({
  handoffId: z.string().uuid(),
  mode: z.enum(["topup", "seat_plan", "setup_package"]),
  itemId: z.string().uuid(),
  quantity: z.number().int().min(1).max(10).default(1),
});

/**
 * Handoff-scoped checkout (user-attributed pricing workflow, Phase 3).
 *
 * No operator middleware: clone end-users have no Mission Control account.
 * The single-use, expiring, server-minted handoff token IS the credential —
 * it pins the clone/tenant the purchase lands on (never taken from input),
 * restricts the purchasable item to the handoff's intent, and is burned the
 * moment a Stripe session exists. Stripe itself authenticates the payment.
 */
export const createHandoffCheckout = createServerFn({ method: "POST" })
  .inputValidator((input) => HandoffCheckoutSchema.parse(input))
  .handler(async ({ data }) => {
    const handoff = await loadValidHandoff(data.handoffId);
    if (!handoff) return { ok: false as const, error: "handoff_invalid" };
    if (!intentAllows(handoff.intent, data.mode, data.itemId)) {
      return { ok: false as const, error: "handoff_intent_mismatch" };
    }

    const h = encodeURIComponent(handoff.id);
    return await startCheckoutCore({
      mode: data.mode,
      itemId: data.itemId,
      quantity: data.quantity,
      // Scope comes strictly from the handoff — input cannot redirect the
      // purchase onto another clone or tenant.
      cloneId: handoff.clone_id,
      tenantId: handoff.tenant_id ?? undefined,
      // The h param lets the success/cancel pages do a non-operator lookup
      // (session_id + matching handoff pair) and offer the return link.
      successPath: `/billing/success?h=${h}`,
      cancelPath: `/billing/cancel?h=${h}`,
      attribution: {
        originUserId: handoff.origin_user_id,
        originUsername: handoff.origin_username,
        originSource: handoff.origin_source,
        handoffId: handoff.id,
      },
      handoffToConsume: handoff.id,
    });
  });
