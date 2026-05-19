import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonResponse, resolveCloneApiKey } from "@/server/clone-api-keys.server";

export const Route = createFileRoute("/api/public/seats/list")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const key = await resolveCloneApiKey(request.headers.get("x-clone-api-key"), "seats:manage");
        if (!key) return jsonResponse({ ok: false, error: "unauthorized" }, 401);
        const url = new URL(request.url);
        const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1), 500);
        const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);
        const status = url.searchParams.get("status"); // reserved|active|removed|null
        let q = supabaseAdmin
          .from("clone_seats" as never)
          .select("id, external_user_id, email, display_name, status, device_count, created_at, committed_at, removed_at", { count: "exact" })
          .order("created_at", { ascending: false })
          .range(offset, offset + limit - 1);
        q = key.clone_id == null ? q.is("clone_id", null) : q.eq("clone_id", key.clone_id);
        if (status) q = q.eq("status", status);
        const { data, error, count } = await q;
        if (error) return jsonResponse({ ok: false, error: error.message }, 500);
        return jsonResponse({ ok: true, seats: data ?? [], total: count ?? 0, limit, offset });
      },
    },
  },
});
