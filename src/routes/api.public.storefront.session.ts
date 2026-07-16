import { createFileRoute } from "@tanstack/react-router";
import { loadHandoffById } from "@/server/billing-handoffs.server";
import {
  buildSessionSummary,
  fulfillmentStatus,
  sessionMatchesHandoff,
  sessionMatchesUid,
} from "@/server/checkout-session.server";
import { storefrontJson, storefrontPreflight } from "@/server/storefront-cors.server";

/**
 * GET /api/public/storefront/session?session_id=cs_…&(h=<uuid>|uid=<id>)
 *
 * Receipt data for the Aurixa Systems website's post-checkout pages.
 * Authorised by possession of the (session_id, credential) pair — the same
 * `h` handoff or `uid` the checkout was scoped to, which only ever exists in
 * the redirect URL Stripe sent that purchaser to. Returns the purchase
 * summary, live fulfilment status (poll until `fulfilled`), and, for handoff
 * purchases, the validated return link back to the purchaser's command center.
 */
export const Route = createFileRoute("/api/public/storefront/session")({
  server: {
    handlers: {
      OPTIONS: async () => storefrontPreflight(),
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const sessionId = url.searchParams.get("session_id") ?? "";
        const h = url.searchParams.get("h") ?? "";
        const uid = url.searchParams.get("uid") ?? "";
        if (!sessionId || sessionId.length > 200 || (!h && !uid)) {
          return storefrontJson({ ok: false, error: "invalid_input" }, 400);
        }

        try {
          const authorized = h
            ? await sessionMatchesHandoff(sessionId, h)
            : await sessionMatchesUid(sessionId, uid);
          if (!authorized) {
            return storefrontJson({ ok: false, error: "not_found" }, 404);
          }
          const [summary, fulfilment, handoff] = await Promise.all([
            buildSessionSummary(sessionId),
            fulfillmentStatus(sessionId),
            h ? loadHandoffById(h) : Promise.resolve(null),
          ]);
          return storefrontJson({
            ok: true,
            mode: summary.mode,
            item_slug: summary.itemSlug,
            clone_name: summary.cloneName ?? summary.tenantName,
            origin_username: summary.originUsername,
            amount_total: summary.amountTotal,
            currency: summary.currency,
            payment_status: summary.paymentStatus,
            fulfilled: fulfilment.fulfilled,
            webhook_error: fulfilment.webhookError,
            return_url: handoff?.return_url ?? null,
          });
        } catch (err) {
          console.error("storefront session lookup failed", err);
          return storefrontJson({ ok: false, error: "lookup_failed" }, 500);
        }
      },
    },
  },
});
