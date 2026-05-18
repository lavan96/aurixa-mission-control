import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  ensureTenant,
  jsonResponse,
  resolveCloneApiKey,
} from "@/server/clone-api-keys.server";
import { checkRateLimit } from "@/server/token-rate-limit.server";

/**
 * GET /api/public/tokens/packs
 *
 * Returns the catalogue of active top-up packs the prime repo can surface
 * (e.g. inside its out-of-tokens banner). Optionally accepts ?tenant_ref=...
 * to also return a deep-link URL into Mission Control's /billing/topup page
 * pre-scoped to that tenant.
 */
export const Route = createFileRoute("/api/public/tokens/packs")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const key = await resolveCloneApiKey(
          request.headers.get("x-clone-api-key"),
          "tokens:meter",
        );
        if (!key) return jsonResponse({ ok: false, error: "unauthorized" }, 401);

        const rl = await checkRateLimit(key.id);
        if (!rl.ok) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: "rate_limited",
              count: rl.count,
              limit: rl.limit,
              retry_after_seconds: rl.retry_after_seconds,
            }),
            {
              status: 429,
              headers: {
                "Content-Type": "application/json",
                "Retry-After": String(rl.retry_after_seconds),
                "X-RateLimit-Limit": String(rl.limit),
                "X-RateLimit-Remaining": "0",
              },
            },
          );
        }

        const { data: packs, error } = await supabaseAdmin
          .from("topup_packs")
          .select("id, slug, name, tokens, price_cents, currency, expires_after_days")
          .eq("is_active", true)
          .order("tokens", { ascending: true });
        if (error) return jsonResponse({ ok: false, error: error.message }, 500);

        const url = new URL(request.url);
        const tenantRef = url.searchParams.get("tenant_ref");
        let topupUrl: string | null = null;
        if (tenantRef) {
          const tenant = await ensureTenant(
            key.clone_id,
            tenantRef,
            url.searchParams.get("display_name") ?? undefined,
          );
          if (tenant.ok) {
            const base =
              process.env.PUBLIC_APP_URL ??
              `${url.protocol}//${url.host}`;
            topupUrl = `${base}/billing/topup?tenant=${encodeURIComponent(tenant.tenantId)}`;
          }
        }

        return new Response(
          JSON.stringify({ ok: true, packs: packs ?? [], topup_url: topupUrl }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "X-RateLimit-Limit": String(rl.limit),
              "X-RateLimit-Remaining": String(Math.max(0, rl.limit - rl.count)),
            },
          },
        );
      },
    },
  },
});
