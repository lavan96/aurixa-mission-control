import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runDriftRefresh } from "@/server/drift-refresh.functions";

// Cron-invoked endpoint. pg_cron schedules a POST here every 5 min.
// Auth: requires DRIFT_REFRESH_TOKEN as Bearer token.
export const Route = createFileRoute("/hooks/drift-refresh")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization");
        const token = auth?.replace("Bearer ", "");
        const expected = process.env.DRIFT_REFRESH_TOKEN;
        if (!token || !expected || token !== expected) {
          return new Response(
            JSON.stringify({ error: "Unauthorized" }),
            { status: 401, headers: { "Content-Type": "application/json" } },
          );
        }

        try {
          const result = await runDriftRefresh(supabaseAdmin);
          return new Response(
            JSON.stringify({ success: true, ...result }),
            { headers: { "Content-Type": "application/json" } },
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Drift refresh failed";
          console.error("Drift refresh failed:", msg);
          return new Response(
            JSON.stringify({ success: false, error: msg }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
