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

export const createStripeCheckout = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const item = await resolveItem(data.mode, data.itemId);
    if (!item) return { ok: false as const, error: "item_not_found" };
    if (!item.is_active) return { ok: false as const, error: "item_inactive" };
    if (!item.stripe_price_id) return { ok: false as const, error: "stripe_price_not_linked" };

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
    const cloneId = data.cloneId ?? handoff?.clone_id ?? null;

    // Topups + setup packages need a tenant. If a cloneId is supplied without
    // an explicit tenantId, auto-resolve (or provision) the clone's primary
    // tenant so the pricing page can be fully client-centric.
    let tenantId = data.tenantId ?? handoff?.tenant_id ?? undefined;
    if ((data.mode === "topup" || data.mode === "setup_package") && !tenantId) {
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

    const sharedMeta = {
      mode: data.mode,
      item_id: data.itemId,
      item_slug: item.slug,
      tenant_id: tenantId ?? "",
      clone_id: cloneId ?? "",
      quantity: String(data.quantity),
      // Attribution contract fields — propagate to the webhook via Stripe so
      // the purchases ledger knows who initiated this checkout, from where.
      ...attributionMetadata(attribution),
    };

    const session = await getStripe().checkout.sessions.create({
      mode: data.mode === "seat_plan" ? "subscription" : "payment",
      customer: customerId,
      line_items: [{ price: item.stripe_price_id, quantity: data.quantity }],
      success_url: `${origin}${data.successPath}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}${data.cancelPath}`,
      allow_promotion_codes: true,
      automatic_tax: { enabled: true },
      metadata: sharedMeta,
      // Propagate metadata onto the Subscription so that subsequent
      // subscription.* / invoice.* webhook events carry tenant/clone context.
      ...(data.mode === "seat_plan"
        ? { subscription_data: { metadata: sharedMeta } }
        : { payment_intent_data: { metadata: sharedMeta } }),
    });

    // Attribution bookkeeping. Best-effort insert (never blocks checkout);
    // the handoff is single-use, so burn it now that a session exists.
    await recordPurchaseInitiated({
      sessionId: session.id,
      mode: data.mode,
      itemId: data.itemId,
      itemSlug: item.slug,
      quantity: data.quantity,
      cloneId,
      tenantId: tenantId ?? null,
      attribution,
    });
    if (handoff) await consumeHandoff(handoff.id);

    return { ok: true as const, url: session.url, sessionId: session.id };
  });