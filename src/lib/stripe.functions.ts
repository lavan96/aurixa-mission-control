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

type Mode = "topup" | "seat_plan" | "setup_package";

const InputSchema = z.object({
  mode: z.enum(["topup", "seat_plan", "setup_package"]),
  tenantId: z.string().uuid().optional(),
  cloneId: z.string().uuid().nullable().optional(),
  itemId: z.string().uuid(),
  quantity: z.number().int().min(1).max(100).default(1),
  successPath: z.string().startsWith("/").default("/billing/success"),
  cancelPath: z.string().startsWith("/").default("/billing/cancel"),
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
  .handler(async ({ data }) => {
    const item = await resolveItem(data.mode, data.itemId);
    if (!item) return { ok: false as const, error: "item_not_found" };
    if (!item.is_active) return { ok: false as const, error: "item_inactive" };
    if (!item.stripe_price_id) return { ok: false as const, error: "stripe_price_not_linked" };

    // Topups + setup packages need a tenant. If a cloneId is supplied without
    // an explicit tenantId, auto-resolve (or provision) the clone's primary
    // tenant so the pricing page can be fully client-centric.
    let tenantId = data.tenantId;
    if ((data.mode === "topup" || data.mode === "setup_package") && !tenantId) {
      if (!data.cloneId) return { ok: false as const, error: "tenant_or_clone_required" };
      // Look up clone display name for nicer Stripe customer naming.
      const { data: clone } = await supabaseAdmin
        .from("clones")
        .select("id, name, slug")
        .eq("id", data.cloneId)
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
      clone_id: data.cloneId ?? "",
      quantity: String(data.quantity),
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

    return { ok: true as const, url: session.url, sessionId: session.id };
  });