import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getCloneHealth } from "@/server/clone-health.server";
import { verifyCronAuth } from "@/server/cron-auth.server";

// Cron-invoked endpoint. pg_cron POSTs here every 5 minutes.
// Auth: requires Bearer DRIFT_REFRESH_TOKEN.
export const Route = createFileRoute("/hooks/warm-health")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = verifyCronAuth(request);
        if (!auth.ok) return auth.response;

        const startedAt = Date.now();
        try {
          const { data: clones } = await supabaseAdmin.from("clones").select("id");
          const list = clones ?? [];
          const results = await Promise.allSettled(
            list.map((c) => getCloneHealth(supabaseAdmin, c.id, { skipCache: true })),
          );
          const ok = results.filter((r) => r.status === "fulfilled").length;
          const failed = results.length - ok;
          const durationMs = Date.now() - startedAt;

          await supabaseAdmin.from("audit_log").insert({
            action: "warm_health_cron",
            entity_type: "cron",
            metadata: { total: list.length, ok, failed, durationMs },
          });

          return new Response(
            JSON.stringify({ success: true, total: list.length, ok, failed, durationMs }),
            { headers: { "Content-Type": "application/json" } },
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Health pre-warm failed";
          console.error("Health pre-warm failed:", msg);
          await supabaseAdmin.from("audit_log").insert({
            action: "warm_health_cron",
            entity_type: "cron",
            metadata: { error: msg, durationMs: Date.now() - startedAt },
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
