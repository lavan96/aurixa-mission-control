import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runBrandDriftScan } from "@/server/branding.server";
import { verifyCronAuth } from "@/server/cron-auth.server";

// Cron-invoked endpoint. pg_cron schedules a POST here every 30 min.
// Auth: requires the shared CRON_SECRET as a Bearer token.
export const Route = createFileRoute("/hooks/brand-drift")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = verifyCronAuth(request);
        if (unauthorized) return unauthorized;

        try {
          const result = await runBrandDriftScan(supabaseAdmin);
          return new Response(JSON.stringify({ success: true, ...result }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Brand drift scan failed";
          console.error("Brand drift scan failed:", msg);
          return new Response(
            JSON.stringify({ success: false, error: msg }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
