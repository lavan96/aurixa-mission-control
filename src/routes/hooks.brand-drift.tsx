import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runBrandDriftScan } from "@/server/branding.server";

// Cron-invoked endpoint. pg_cron schedules a POST here every 30 min.
// Auth: requires Supabase publishable key as Bearer token (matches /hooks/fleet-drift).
export const Route = createFileRoute("/hooks/brand-drift")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization");
        const token = auth?.replace("Bearer ", "");
        const expected =
          process.env.SUPABASE_PUBLISHABLE_KEY ||
          process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        if (!token || !expected || token !== expected) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

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
