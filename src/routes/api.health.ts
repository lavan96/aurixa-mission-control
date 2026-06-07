import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Machine-readable health endpoint. Returns JSON with sub-system status.
// Used by uptime monitors and the /health dashboard.
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const started = Date.now();
        const checks: Record<string, { ok: boolean; latency_ms?: number; error?: string }> = {};

        // DB ping
        const dbStart = Date.now();
        try {
          const { error } = await supabaseAdmin
            .from("clones")
            .select("id", { count: "exact", head: true })
            .limit(1);
          checks.database = { ok: !error, latency_ms: Date.now() - dbStart, error: error?.message };
        } catch (e) {
          checks.database = {
            ok: false,
            latency_ms: Date.now() - dbStart,
            error: e instanceof Error ? e.message : "unknown",
          };
        }

        // Required env / secret presence (no values leaked)
        const requiredEnv = [
          "SUPABASE_URL",
          "SUPABASE_SERVICE_ROLE_KEY",
          "LOVABLE_API_KEY",
          "STRIPE_SECRET_KEY",
          "STRIPE_WEBHOOK_SECRET",
          "GITHUB_APP_ID",
          "DRIFT_REFRESH_TOKEN",
        ];
        const missing = requiredEnv.filter((k) => !process.env[k]);
        checks.secrets = {
          ok: missing.length === 0,
          error: missing.length ? `missing: ${missing.join(",")}` : undefined,
        };

        const allOk = Object.values(checks).every((c) => c.ok);
        return new Response(
          JSON.stringify({
            ok: allOk,
            status: allOk ? "healthy" : "degraded",
            checks,
            latency_ms: Date.now() - started,
            timestamp: new Date().toISOString(),
          }),
          {
            status: allOk ? 200 : 503,
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          },
        );
      },
    },
  },
});
