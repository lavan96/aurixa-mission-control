import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonResponse, resolveCloneApiKey } from "@/server/clone-api-keys.server";
import { checkRateLimit } from "@/server/token-rate-limit.server";

const Schema = z.object({ device_id: z.string().uuid() });

export const Route = createFileRoute("/api/public/seats/devices/heartbeat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = await resolveCloneApiKey(request.headers.get("x-clone-api-key"), [
          "devices:manage",
          "seats:manage",
        ]);
        if (!key) return jsonResponse({ ok: false, error: "unauthorized" }, 401);
        const rl = await checkRateLimit(key.id);
        if (!rl.ok) return jsonResponse({ ok: false, error: "rate_limited" }, 429);
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return jsonResponse({ ok: false, error: "invalid_json" }, 400);
        }
        const parsed = Schema.safeParse(body);
        if (!parsed.success) return jsonResponse({ ok: false, error: "invalid_input" }, 400);
        const { data: result, error } = await supabaseAdmin.rpc(
          "heartbeat_device" as never,
          {
            _device_id: parsed.data.device_id,
          } as never,
        );
        if (error) return jsonResponse({ ok: false, error: error.message }, 500);
        return jsonResponse(result, 200);
      },
    },
  },
});
