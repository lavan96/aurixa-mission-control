import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { runFleetDriftScan } from "@/server/fleet-drift.functions";
import { verifyCronAuth } from "@/server/cron-auth.server";

// Cron-invoked endpoint. pg_cron schedules a POST here every 15 min.
// Auth: requires the shared CRON_SECRET as a Bearer token.
export const Route = createFileRoute("/hooks/fleet-drift")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = verifyCronAuth(request);
        if (unauthorized) return unauthorized;

        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!SUPABASE_URL || !SERVICE_KEY) {
          return new Response(
            JSON.stringify({ error: "Server not configured" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }

        const admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        try {
          const result = await runFleetDriftScan(admin);
          return new Response(
            JSON.stringify({ success: true, ...result }),
            { headers: { "Content-Type": "application/json" } },
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Scan failed";
          console.error("Drift scan failed:", msg);
          return new Response(
            JSON.stringify({ success: false, error: msg }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
