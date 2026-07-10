// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { startHandoffCheckout } from "@/server/checkout.server";
import { storefrontPricingBase } from "@/server/billing-handoffs.server";
import { storefrontJson, storefrontPreflight } from "@/server/storefront-cors.server";

/**
 * POST /api/public/storefront/checkout
 *
 * Handoff-scoped Stripe checkout for the customer-facing Aurixa Systems
 * pricing page. No login: the single-use, expiring, server-minted handoff
 * token is the credential — it pins the clone/tenant the purchase lands on,
 * restricts the purchasable item to its intent, and burns on session
 * creation. Success/cancel redirect back to the STOREFRONT's own receipt
 * pages (never Mission Control's UI), carrying the (session_id, h) pair the
 * receipt endpoint requires.
 */
const Schema = z.object({
  h: z.string().uuid(),
  mode: z.enum(["topup", "seat_plan", "setup_package"]),
  item_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(10).default(1),
});

export const Route = createFileRoute("/api/public/storefront/checkout")({
  server: {
    handlers: {
      OPTIONS: async () => storefrontPreflight(),
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return storefrontJson({ ok: false, error: "invalid_json" }, 400);
        }
        const parsed = Schema.safeParse(body);
        if (!parsed.success) {
          return storefrontJson(
            { ok: false, error: "invalid_input", issues: parsed.error.issues },
            400,
          );
        }
        const data = parsed.data;

        const url = new URL(request.url);
        const mcOrigin = process.env.PUBLIC_APP_URL ?? `${url.protocol}//${url.host}`;
        const h = encodeURIComponent(data.h);
        // When the storefront is configured, receipts render on its own
        // /pricing/success|cancel pages. The unconfigured fallback keeps the
        // flow working end-to-end via Mission Control's receipt pages (which
        // also accept the (session_id, h) pair).
        const site = process.env.PUBLIC_PRICING_SITE_URL;
        const onStorefront = !!site && /^https?:\/\//.test(site);
        const pricingBase = storefrontPricingBase(mcOrigin);
        const successUrl = onStorefront
          ? `${pricingBase}/success?h=${h}&session_id={CHECKOUT_SESSION_ID}`
          : `${mcOrigin}/billing/success?h=${h}&session_id={CHECKOUT_SESSION_ID}`;
        const cancelUrl = onStorefront
          ? `${pricingBase}/cancel?h=${h}`
          : `${mcOrigin}/billing/cancel?h=${h}`;

        try {
          const result = await startHandoffCheckout({
            handoffId: data.h,
            mode: data.mode,
            itemId: data.item_id,
            quantity: data.quantity,
            successUrl,
            cancelUrl,
          });
          if (!result.ok) return storefrontJson(result, 400);
          return storefrontJson({ ok: true, url: result.url, session_id: result.sessionId });
        } catch (err) {
          console.error("storefront checkout failed", err);
          return storefrontJson({ ok: false, error: "checkout_failed" }, 500);
        }
      },
    },
  },
});
