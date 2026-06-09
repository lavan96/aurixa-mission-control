import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runDueSchedules } from "@/server/schedules.server";
import { verifyCronAuth } from "@/server/cron-auth.server";

// Cron-invoked endpoint. pg_cron schedules a POST here every minute.
// Auth: requires the shared CRON_SECRET as a Bearer token.
export const Route = createFileRoute("/hooks/run-schedules")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = verifyCronAuth(request);
        if (unauthorized) return unauthorized;

        try {
          const result = await runDueSchedules(supabaseAdmin);
          return new Response(
            JSON.stringify({ success: true, ...result }),
            { headers: { "Content-Type": "application/json" } },
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Schedule run failed";
          console.error("Schedule run failed:", msg);
          return new Response(
            JSON.stringify({ success: false, error: msg }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
