import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyCronAuth } from "@/server/cron-auth.server";

// Cron-invoked endpoint. pg_cron schedules a POST here every 5 min.
// Auth: requires the shared CRON_SECRET as a Bearer token.
export const Route = createFileRoute("/hooks/expire-reservations")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = verifyCronAuth(request);
        if (unauthorized) return unauthorized;
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
