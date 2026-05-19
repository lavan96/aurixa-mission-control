import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonResponse, resolveCloneApiKey } from "@/server/clone-api-keys.server";
import { checkRateLimit } from "@/server/token-rate-limit.server";
import { fireSeatWebhook } from "@/server/seats.server";

const Schema = z.object({ seat_id: z.string().uuid() });

export const Route = createFileRoute("/api/public/seats/commit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = await resolveCloneApiKey(request.headers.get("x-clone-api-key"), "seats:manage");
        if (!key) return jsonResponse({ ok: false, error: "unauthorized" }, 401);
        const rl = await checkRateLimit(key.id);
        if (!rl.ok) return jsonResponse({ ok: false, error: "rate_limited" }, 429);
        let body: unknown;
        try { body = await request.json(); } catch { return jsonResponse({ ok: false, error: "invalid_json" }, 400); }
        const parsed = Schema.safeParse(body);
        if (!parsed.success) return jsonResponse({ ok: false, error: "invalid_input" }, 400);
        const { data: result, error } = await supabaseAdmin.rpc("commit_seat" as never, {
          _seat_id: parsed.data.seat_id,
        } as never);
        if (error) return jsonResponse({ ok: false, error: error.message }, 500);
        const res = result as any;
        if (res?.ok) fireSeatWebhook("seats.committed", { seat_id: parsed.data.seat_id, ...res }, key.clone_id).catch(() => {});
        return jsonResponse(res, 200);
      },
    },
  },
});
