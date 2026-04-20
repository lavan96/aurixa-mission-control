import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getCloneHealth } from "@/server/clone-health.server";

// Cron-invoked endpoint. pg_cron POSTs here every 5 minutes to pre-warm the
// clone_health_snapshots cache so /health is always instant — no operator ever
// waits for the first probe. Auth: requires Supabase publishable key as Bearer.
export const Route = createFileRoute("/hooks/warm-health")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization");
        const token = auth?.replace("Bearer ", "");
        const expected =
          process.env.SUPABASE_PUBLISHABLE_KEY ||
          process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        if (!token || !expected || token !== expected) {
          return new Response(
            JSON.stringify({ error: "Unauthorized" }),
            { status: 401, headers: { "Content-Type": "application/json" } },
          );
        }

        const startedAt = Date.now();
        try {
          const { data: clones } = await supabaseAdmin
            .from("clones")
            .select("id");
          const list = clones ?? [];
          // Force a fresh probe for every clone in parallel. getCloneHealth
          // writes the snapshot row at the end; failures are isolated per-clone.
          const results = await Promise.allSettled(
            list.map((c) => getCloneHealth(supabaseAdmin, c.id, { skipCache: true })),
          );
          const ok = results.filter((r) => r.status === "fulfilled").length;
          const failed = results.length - ok;
          const durationMs = Date.now() - startedAt;

          // Audit-log every cron run so pre-warm regressions are debuggable
          // from /audit-log instead of poking around cron.job_run_details.
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
          return new Response(
            JSON.stringify({ success: false, error: msg }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
