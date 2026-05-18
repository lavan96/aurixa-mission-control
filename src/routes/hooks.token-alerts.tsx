import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fireTokenWebhook, retryDueDeliveries } from "@/server/token-webhooks.server";

// Cron-invoked. Scans tenants for allowance thresholds and cancel-rate spikes,
// fans notifications, fires webhooks, and retries failed webhook deliveries.
export const Route = createFileRoute("/hooks/token-alerts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization");
        const token = auth?.replace("Bearer ", "");
        const expected = process.env.DRIFT_REFRESH_TOKEN;
        if (!token || !expected || token !== expected) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const out = {
          tenants_checked: 0,
          allowance_alerts: 0,
          cancel_spike_alerts: 0,
          webhook_retries: 0,
        };

        const { data: tenants } = await supabaseAdmin
          .from("tenants")
          .select("id, clone_id, external_ref, display_name, status")
          .eq("status", "active")
          .limit(500);

        for (const t of tenants ?? []) {
          out.tenants_checked += 1;
          const summary = await supabaseAdmin.rpc("tenant_usage_summary", { _tenant_id: t.id });
          const s = (summary.data ?? {}) as Record<string, number | null>;

          const pct = Number(s.allowance_used_pct ?? 0);
          for (const threshold of [80, 100]) {
            if (pct >= threshold) {
              const dedupeKey = `allowance_${threshold}_${t.id}_${new Date().toISOString().slice(0, 10)}`;
              const existing = await supabaseAdmin
                .from("notifications")
                .select("id")
                .eq("kind", "system")
                .contains("metadata", { dedupe_key: dedupeKey })
                .maybeSingle();
              if (!existing.data) {
                await supabaseAdmin.from("notifications").insert({
                  kind: "system",
                  severity: threshold >= 100 ? "critical" : "warning",
                  title: `${t.display_name ?? t.external_ref} crossed ${threshold}% allowance`,
                  body: `Used ${Math.round(pct)}% of monthly allowance.`,
                  clone_id: t.clone_id,
                  url: "/settings/billing",
                  metadata: { dedupe_key: dedupeKey, tenant_id: t.id, pct },
                });
                await fireTokenWebhook(
                  "tokens.alert",
                  {
                    alert: "allowance_threshold",
                    threshold,
                    pct,
                    tenant_ref: t.external_ref,
                    summary: s,
                  },
                  t.clone_id,
                );
                out.allowance_alerts += 1;
              }
            }
          }

          const cancelRate = Number(s.cancel_rate_24h ?? 0);
          const total24 = Number(s.cancels_24h ?? 0) + Number(s.completed_24h ?? 0);
          if (cancelRate >= 0.3 && total24 >= 5) {
            const dedupeKey = `cancel_spike_${t.id}_${new Date().toISOString().slice(0, 10)}`;
            const existing = await supabaseAdmin
              .from("notifications")
              .select("id")
              .eq("kind", "system")
              .contains("metadata", { dedupe_key: dedupeKey })
              .maybeSingle();
            if (!existing.data) {
              await supabaseAdmin.from("notifications").insert({
                kind: "system",
                severity: "warning",
                title: `Cancel spike on ${t.display_name ?? t.external_ref}`,
                body: `${Math.round(cancelRate * 100)}% of last-24h jobs canceled/failed.`,
                clone_id: t.clone_id,
                url: "/report-jobs",
                metadata: { dedupe_key: dedupeKey, tenant_id: t.id, cancel_rate: cancelRate },
              });
              await fireTokenWebhook(
                "tokens.alert",
                {
                  alert: "cancel_spike",
                  cancel_rate: cancelRate,
                  tenant_ref: t.external_ref,
                  summary: s,
                },
                t.clone_id,
              );
              out.cancel_spike_alerts += 1;
            }
          }
        }

        const retried = await retryDueDeliveries();
        out.webhook_retries = retried.retried;

        return new Response(JSON.stringify({ success: true, ...out }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
