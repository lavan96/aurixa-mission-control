import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Cron-invoked endpoint. pg_cron schedules a POST here every 5 min.
// Auth: requires DRIFT_REFRESH_TOKEN (reused shared cron secret) as Bearer token.
export const Route = createFileRoute("/hooks/expire-reservations")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization");
        const bearer = auth?.replace("Bearer ", "");
        const apikey = request.headers.get("apikey");
        const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
        const drift = process.env.DRIFT_REFRESH_TOKEN;
        const ok = (drift && bearer && bearer === drift) || (anon && apikey && apikey === anon);
        if (!ok) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        try {
          const { data, error } = await supabaseAdmin.rpc("expire_stale_reservations");
          if (error) throw new Error(error.message);
          // Also revoke any scheduled rotations whose grace period has elapsed
          const rev = await supabaseAdmin.rpc("revoke_scheduled_keys");
          return new Response(
            JSON.stringify({ success: true, ...(data as object), revoked_keys: rev.data }),
            { headers: { "Content-Type": "application/json" } },
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : "expire failed";
          return new Response(JSON.stringify({ success: false, error: msg }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
