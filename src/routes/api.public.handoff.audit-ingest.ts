// G23 — Public ingest endpoint for shipped audit events from client backends.
//
// Auth: HMAC-SHA256 over the raw body using the per-handoff shipper secret.
// Client sends x-handoff-id and x-handoff-signature. This route is inside
// /api/public/* so no session is required — verification is the sole gate.
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";

export const Route = createFileRoute("/api/public/handoff/audit-ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const handoffId = request.headers.get("x-handoff-id");
        const sig = request.headers.get("x-handoff-signature");
        if (!handoffId || !sig) {
          return new Response("missing headers", { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: cfg, error: cfgErr } = await supabaseAdmin
          .from("handoff_audit_shippers")
          .select("id, hmac_secret, enabled, total_shipped")
          .eq("handoff_id", handoffId)
          .maybeSingle();
        if (cfgErr || !cfg) return new Response("unknown handoff", { status: 404 });
        if (!cfg.enabled) return new Response("shipper disabled", { status: 403 });

        const expected = createHmac("sha256", cfg.hmac_secret).update(raw).digest("hex");
        const a = Buffer.from(sig, "hex");
        const b = Buffer.from(expected, "hex");
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          await supabaseAdmin
            .from("handoff_audit_shippers")
            .update({ last_error: "signature_mismatch" })
            .eq("id", cfg.id);
          return new Response("bad signature", { status: 401 });
        }

        let payload: any;
        try {
          payload = JSON.parse(raw);
        } catch {
          return new Response("bad json", { status: 400 });
        }
        const events = Array.isArray(payload?.events) ? payload.events : [];
        if (events.length === 0)
          return new Response(JSON.stringify({ ok: true, inserted: 0 }), { status: 200 });

        const projectRef: string | null = payload.project_ref ?? null;
        const rows = events.slice(0, 1000).map((e: any) => ({
          handoff_id: handoffId,
          source_event_id: String(e.id ?? e.event_id ?? crypto.randomUUID()),
          source_project_ref: projectRef,
          source_table: e.source_table ?? "audit_log",
          action: e.action ?? null,
          actor: e.actor ?? e.actor_id ?? null,
          occurred_at: e.created_at ?? e.occurred_at ?? null,
          payload: e,
        }));

        const { error: insErr, count } = await supabaseAdmin
          .from("handoff_audit_events")
          .upsert(rows, {
            onConflict: "handoff_id,source_event_id",
            ignoreDuplicates: true,
            count: "exact",
          });
        if (insErr) {
          await supabaseAdmin
            .from("handoff_audit_shippers")
            .update({ last_error: insErr.message })
            .eq("id", cfg.id);
          return new Response(insErr.message, { status: 500 });
        }

        const inserted = count ?? rows.length;
        await supabaseAdmin
          .from("handoff_audit_shippers")
          .update({
            last_shipped_at: new Date().toISOString(),
            last_event_at: new Date().toISOString(),
            total_shipped: (cfg.total_shipped ?? 0) + inserted,
            last_error: null,
          })
          .eq("id", cfg.id);

        return new Response(JSON.stringify({ ok: true, inserted }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
