import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonResponse, resolveCloneApiKey } from "@/server/clone-api-keys.server";
import { checkRateLimit } from "@/server/token-rate-limit.server";
import { fireSeatWebhook } from "@/server/seats.server";

const Schema = z
  .object({
    device_id: z.string().uuid().optional(),
    external_user_id: z.string().min(1).max(200).optional(),
    device_fingerprint: z.string().min(8).max(256).optional(),
    reason: z.string().max(500).optional(),
  })
  .refine((v) => v.device_id || (v.external_user_id && v.device_fingerprint), {
    message: "device_id OR (external_user_id + device_fingerprint) is required",
  });

export const Route = createFileRoute("/api/public/seats/devices/release")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = await resolveCloneApiKey(request.headers.get("x-clone-api-key"), ["devices:manage", "seats:manage"]);
        if (!key) return jsonResponse({ ok: false, error: "unauthorized" }, 401);
        const rl = await checkRateLimit(key.id);
        if (!rl.ok) return jsonResponse({ ok: false, error: "rate_limited" }, 429);
        let body: unknown;
        try { body = await request.json(); } catch { return jsonResponse({ ok: false, error: "invalid_json" }, 400); }
        const parsed = Schema.safeParse(body);
        if (!parsed.success) return jsonResponse({ ok: false, error: "invalid_input" }, 400);
        const d = parsed.data;
        const { data: result, error } = await supabaseAdmin.rpc("release_device" as never, {
          _device_id: d.device_id ?? null,
          _clone_id: key.clone_id,
          _external_user_id: d.external_user_id ?? null,
          _device_fingerprint: d.device_fingerprint ?? null,
          _reason: d.reason ?? null,
        } as never);
        if (error) return jsonResponse({ ok: false, error: error.message }, 500);
        const res = result as any;
        if (res?.ok && !res?.idempotent) {
          fireSeatWebhook("devices.released" as never, res, key.clone_id).catch(() => {});
        }
        return jsonResponse(res, 200);
      },
    },
  },
});
