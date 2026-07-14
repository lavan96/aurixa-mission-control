// @ts-nocheck
// Cron/manual hook that mirrors the Airtable "Aurixa Waitlist" base into
// public.waitlist_leads. Silent — never inserts a lead_captured notification.
// Auth: Bearer CRON_SECRET (or DRIFT_REFRESH_TOKEN, per verifyCronAuth).
import { createFileRoute } from "@tanstack/react-router";
import { verifyCronAuth } from "@/server/cron-auth.server";
import { syncAirtableWaitlist } from "@/server/airtable-sync.server";

export const Route = createFileRoute("/hooks/airtable-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = verifyCronAuth(request);
        if (!auth.ok) return auth.response;

        try {
          const result = await syncAirtableWaitlist();
          return new Response(JSON.stringify({ ok: true, ...result }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (err) {
          console.error("airtable sync failed", err);
          return new Response(
            JSON.stringify({
              ok: false,
              error: err instanceof Error ? err.message : "unknown_error",
            }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
