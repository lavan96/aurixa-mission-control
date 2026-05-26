// Stripe Checkout server functions.
// Creates Stripe Checkout Sessions for top-up packs, seat plans, and setup packages.
// The webhook (api/public/stripe/webhook) finalises the purchase server-side.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getStripe } from "@/server/stripe.server";
import { getRequestHost } from "@tanstack/react-start/server";

type Mode = "topup" | "seat_plan" | "setup_package";

const InputSchema = z.object({
  mode: z.enum(["topup", "seat_plan", "setup_package"]),
  tenantId: z.string().uuid().optional(),
  cloneId: z.string().uuid().optional(),
  itemId: z.string().uuid(),
  quantity: z.number().int().min(1).max(100).default(1),
  successPath: z.string().startsWith("/").default("/billing/success"),
  cancelPath: z.string().startsWith("/").default("/billing/cancel"),
});

async function resolveItem(mode: Mode, itemId: string) {
  if (mode === "topup") {
    const { data } = await supabaseAdmin
      .from("topup_packs")
      .select("id, slug, name, stripe_price_id, currency, is_active")
      .eq("id", itemId).maybeSingle();
    return data;
  }
  if (mode === "seat_plan") {
    const { data } = await supabaseAdmin
      .from("seat_plans")
      .select("id, slug, name, stripe_price_id, currency, is_active")
      .eq("id", itemId).maybeSingle();
    return data;
  }
  const { data } = await supabaseAdmin
    .from("setup_packages" as never)
    .select("id, slug, name, stripe_price_id, currency, is_active")
    .eq("id", itemId).maybeSingle();
  return data as { id: string; slug: string; name: string; stripe_price_id: string | null; currency: string; is_active: boolean } | null;
}

async function ensureStripeCustomer(tenantId: string): Promise<string> {
  const { data: tenant } = await supabaseAdmin
    .from("tenants")
    .select("id, display_name, external_ref, stripe_customer_id")
    .eq("id", tenantId).maybeSingle();
  if (!tenant) throw new Error("tenant_not_found");
  if (tenant.stripe_customer_id) return tenant.stripe_customer_id;

  const customer = await getStripe().customers.create({
    name: tenant.display_name ?? tenant.external_ref ?? `tenant_${tenantId.slice(0, 8)}`,
    metadata: { tenant_id: tenantId, external_ref: tenant.external_ref ?? "" },
  });
  await supabaseAdmin
    .from("tenants").update({ stripe_customer_id: customer.id }).eq("id", tenantId);
  return customer.id;
}

export const createStripeCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const item = await resolveItem(data.mode, data.itemId);
    if (!item) return { ok: false as const, error: "item_not_found" };
    if (!item.is_active) return { ok: false as const, error: "item_inactive" };
    if (!item.stripe_price_id) return { ok: false as const, error: "stripe_price_not_linked" };

    // Seat plans must be tied to a clone; topup + setup require a tenant.
    if (data.mode === "seat_plan" && !data.cloneId) {
      return { ok: false as const, error: "clone_required" };
    }
    if ((data.mode === "topup" || data.mode === "setup_package") && !data.tenantId) {
      return { ok: false as const, error: "tenant_required" };
    }

    let customerId: string | undefined;
    if (data.tenantId) customerId = await ensureStripeCustomer(data.tenantId);

    const host = getRequestHost();
    const proto = host.startsWith("localhost") ? "http" : "https";
    const origin = `${proto}://${host}`;

    const session = await getStripe().checkout.sessions.create({
      mode: data.mode === "seat_plan" ? "subscription" : "payment",
      customer: customerId,
      line_items: [{ price: item.stripe_price_id, quantity: data.quantity }],
      success_url: `${origin}${data.successPath}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}${data.cancelPath}`,
      allow_promotion_codes: true,
      automatic_tax: { enabled: true },
      metadata: {
        mode: data.mode,
        item_id: data.itemId,
        item_slug: item.slug,
        tenant_id: data.tenantId ?? "",
        clone_id: data.cloneId ?? "",
        quantity: String(data.quantity),
      },
    });

    return { ok: true as const, url: session.url, sessionId: session.id };
  });
