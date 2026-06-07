import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyCronAuth } from "@/server/cron-auth.server";

// Cron-invoked endpoint. pg_cron schedules a POST here every 5 min.
// Auth: requires Bearer DRIFT_REFRESH_TOKEN (sourced by pg_cron from Vault).
export const Route = createFileRoute("/hooks/expire-reservations")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = verifyCronAuth(request);
        if (!auth.ok) return auth.response;
        try {
          const { data, error } = await supabaseAdmin.rpc("expire_stale_reservations");
          if (error) throw new Error(error.message);
          const rev = await supabaseAdmin.rpc("revoke_scheduled_keys");
          await supabaseAdmin.from("audit_log").insert({
            action: "expire_reservations_cron",
            entity_type: "cron",
            metadata: { result: data, revoked_keys: rev.data },
          });
          return new Response(
            JSON.stringify({ success: true, ...(data as object), revoked_keys: rev.data }),
            { headers: { "Content-Type": "application/json" } },
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : "expire failed";
          console.error("expire-reservations cron failed:", msg);
          await supabaseAdmin.from("audit_log").insert({
            action: "expire_reservations_cron",
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
