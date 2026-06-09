import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runDueSchedules } from "@/server/schedules.server";
import { verifyCronAuth } from "@/server/cron-auth.server";

// Cron-invoked endpoint. pg_cron schedules a POST here every minute.
// Auth: requires Bearer DRIFT_REFRESH_TOKEN.
export const Route = createFileRoute("/hooks/run-schedules")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = verifyCronAuth(request);
        if (!auth.ok) return auth.response;

        try {
          const result = await runDueSchedules(supabaseAdmin);
          return new Response(JSON.stringify({ success: true, ...result }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Schedule run failed";
          console.error("Schedule run failed:", msg);
          await supabaseAdmin.from("audit_log").insert({
            action: "run_schedules_cron",
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
