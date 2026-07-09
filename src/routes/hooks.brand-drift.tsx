// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runBrandDriftScan } from "@/server/branding.server";
import { verifyCronAuth } from "@/server/cron-auth.server";

// Cron-invoked endpoint. pg_cron schedules a POST here every 30 min.
// Auth: requires Bearer DRIFT_REFRESH_TOKEN.
export const Route = createFileRoute("/hooks/brand-drift")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = verifyCronAuth(request);
        if (!auth.ok) return auth.response;

        try {
          const result = await runBrandDriftScan(supabaseAdmin);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabaseAdmin as any).from("audit_log").insert({
            action: "brand_drift_cron",
            entity_type: "cron",
            metadata: result as Record<string, unknown>,
          });
          return new Response(JSON.stringify({ success: true, ...result }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Brand drift scan failed";
          console.error("Brand drift scan failed:", msg);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabaseAdmin as any).from("audit_log").insert({
            action: "brand_drift_cron",
            entity_type: "cron",
            metadata: { error: msg },
          });
          return new Response(JSON.stringify({ success: false, error: msg }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});