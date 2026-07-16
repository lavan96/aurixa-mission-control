// G20 — Cron drain for PAT-based observability polls.
// pg_cron POSTs here every 15 minutes with Bearer DRIFT_REFRESH_TOKEN.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyCronAuth } from "@/server/cron-auth.server";

export const Route = createFileRoute("/hooks/handoff-observability-poll")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = verifyCronAuth(request);
        if (!auth.ok) return auth.response;
        try {
          const { drainDueObservabilityPolls } =
            await import("@/server/handoff-observability.server");
          const result = await drainDueObservabilityPolls(20);
          await supabaseAdmin.from("audit_log").insert({
            action: "handoff_observability_poll_cron",
            entity_type: "cron",
            metadata: result,
          });
          return new Response(JSON.stringify(result), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "poll failed";
          await supabaseAdmin.from("audit_log").insert({
            action: "handoff_observability_poll_cron",
            entity_type: "cron",
            metadata: { error: msg },
          });
          return new Response(JSON.stringify({ ok: false, error: msg }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
