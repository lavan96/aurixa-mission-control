import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  jsonResponse,
  resolveCloneApiKey,
} from "@/server/clone-api-keys.server";

const Schema = z.object({
  job_id: z.string().uuid(),
  reason: z.string().max(300).optional(),
});

export const Route = createFileRoute("/api/public/tokens/cancel")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = await resolveCloneApiKey(
          request.headers.get("x-clone-api-key"),
          "tokens:meter",
        );
        if (!key) return jsonResponse({ ok: false, error: "unauthorized" }, 401);
        let body: unknown;
        try { body = await request.json(); } catch { return jsonResponse({ ok: false, error: "invalid_json" }, 400); }
        const parsed = Schema.safeParse(body);
        if (!parsed.success) return jsonResponse({ ok: false, error: "invalid_input", issues: parsed.error.issues }, 400);

        const job = await supabaseAdmin
          .from("report_jobs")
          .select("clone_id")
          .eq("id", parsed.data.job_id)
          .maybeSingle();
        if (!job.data) return jsonResponse({ ok: false, error: "job_not_found" }, 404);
        if (job.data.clone_id !== key.clone_id) return jsonResponse({ ok: false, error: "forbidden" }, 403);

        const { data: result, error } = await supabaseAdmin.rpc("cancel_token_reservation", {
          _job_id: parsed.data.job_id,
          _reason: parsed.data.reason ?? null,
        });
        if (error) return jsonResponse({ ok: false, error: error.message }, 500);
        return jsonResponse(result, 200);
      },
    },
  },
});
