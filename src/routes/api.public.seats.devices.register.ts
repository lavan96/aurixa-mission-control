import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonResponse, resolveCloneApiKey } from "@/server/clone-api-keys.server";
import { checkRateLimit } from "@/server/token-rate-limit.server";
import { fireSeatWebhook } from "@/server/seats.server";

const Schema = z.object({
  external_user_id: z.string().min(1).max(200),
  device_fingerprint: z.string().min(8).max(256).regex(/^[A-Za-z0-9._:\-+/=]+$/),
  device_label: z.string().max(200).optional().nullable(),
  user_agent: z.string().max(500).optional().nullable(),
  ip_address: z.string().max(64).optional().nullable(),
  platform: z.string().max(64).optional().nullable(),
});

export const Route = createFileRoute("/api/public/seats/devices/register")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = await resolveCloneApiKey(request.headers.get("x-clone-api-key"), "seats:manage");
        if (!key) return jsonResponse({ ok: false, error: "unauthorized" }, 401);
        const rl = await checkRateLimit(key.id);
        if (!rl.ok) {
          return new Response(
            JSON.stringify({ ok: false, error: "rate_limited", retry_after_seconds: rl.retry_after_seconds }),
            { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(rl.retry_after_seconds) } },
          );
        }
        let body: unknown;
        try { body = await request.json(); } catch { return jsonResponse({ ok: false, error: "invalid_json" }, 400); }
        const parsed = Schema.safeParse(body);
        if (!parsed.success) return jsonResponse({ ok: false, error: "invalid_input", issues: parsed.error.issues }, 400);
        const d = parsed.data;
        const { data: result, error } = await supabaseAdmin.rpc("register_device" as never, {
          _clone_id: key.clone_id,
          _external_user_id: d.external_user_id,
          _device_fingerprint: d.device_fingerprint,
          _device_label: d.device_label ?? null,
          _user_agent: d.user_agent ?? request.headers.get("user-agent"),
          _ip_address: d.ip_address ?? request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for"),
          _platform: d.platform ?? null,
        } as never);
        if (error) return jsonResponse({ ok: false, error: error.message }, 500);
        const res = result as any;
        const status = res?.error === "device_limit_reached" ? 402 : res?.error === "seat_not_found" ? 404 : 200;
        if (res?.ok && !res?.idempotent) {
          fireSeatWebhook("devices.registered" as never, { external_user_id: d.external_user_id, ...res }, key.clone_id).catch(() => {});
        }
        if (res?.error === "device_limit_reached") {
          fireSeatWebhook("devices.limit.reached" as never, { external_user_id: d.external_user_id, ...res }, key.clone_id).catch(() => {});
        }
        return jsonResponse(res, status);
      },
    },
  },
});
