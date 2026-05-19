import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonResponse, resolveCloneApiKey } from "@/server/clone-api-keys.server";

export const Route = createFileRoute("/api/public/seats/devices/list")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const key = await resolveCloneApiKey(request.headers.get("x-clone-api-key"), "seats:manage");
        if (!key) return jsonResponse({ ok: false, error: "unauthorized" }, 401);
        const url = new URL(request.url);
        const externalUserId = url.searchParams.get("external_user_id");
        const status = url.searchParams.get("status") ?? "active";
        const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "100", 10) || 100, 1), 500);
        const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);

        let q = supabaseAdmin
          .from("clone_seat_devices" as never)
          .select(
            "id, seat_id, external_user_id, device_fingerprint, device_label, platform, status, first_seen_at, last_seen_at, revoked_at",
            { count: "exact" },
          )
          .order("last_seen_at", { ascending: false })
          .range(offset, offset + limit - 1);
        q = key.clone_id == null ? q.is("clone_id", null) : q.eq("clone_id", key.clone_id);
        if (status && status !== "all") q = q.eq("status", status);
        if (externalUserId) q = q.eq("external_user_id", externalUserId);
        const { data, error, count } = await q;
        if (error) return jsonResponse({ ok: false, error: error.message }, 500);
        return jsonResponse({ ok: true, devices: data ?? [], total: count ?? 0, limit, offset });
      },
    },
  },
});
