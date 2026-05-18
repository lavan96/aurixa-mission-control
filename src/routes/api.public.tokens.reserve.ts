import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  ensureTenant,
  jsonResponse,
  resolveCloneApiKey,
} from "@/server/clone-api-keys.server";

const Schema = z.object({
  tenant_ref: z.string().min(1).max(200),
  display_name: z.string().max(200).optional().nullable(),
  kind: z.string().min(1).max(64),
  estimated_tokens: z.number().int().min(0).max(10_000_000),
  idempotency_key: z.string().min(1).max(200),
  ttl_seconds: z.number().int().min(30).max(86_400).optional(),
  request_payload: z.record(z.string(), z.unknown()).optional(),
});

export const Route = createFileRoute("/api/public/tokens/reserve")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = await resolveCloneApiKey(
          request.headers.get("x-clone-api-key"),
          "tokens:meter",
        );
        if (!key) return jsonResponse({ ok: false, error: "unauthorized" }, 401);

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return jsonResponse({ ok: false, error: "invalid_json" }, 400);
        }
        const parsed = Schema.safeParse(body);
        if (!parsed.success) {
          return jsonResponse(
            { ok: false, error: "invalid_input", issues: parsed.error.issues },
            400,
          );
        }
        const data = parsed.data;

        const tenant = await ensureTenant(
          key.clone_id,
          data.tenant_ref,
          data.display_name ?? undefined,
        );
        if (!tenant.ok) return jsonResponse(tenant, 500);

        const { data: result, error } = await supabaseAdmin.rpc("reserve_tokens", {
          _tenant_id: tenant.tenantId,
          _clone_id: key.clone_id,
          _kind: data.kind,
          _estimated_tokens: data.estimated_tokens,
          _idempotency_key: data.idempotency_key,
          _ttl_seconds: data.ttl_seconds ?? 600,
          _request_payload: data.request_payload ?? {},
        });
        if (error) return jsonResponse({ ok: false, error: error.message }, 500);
        return jsonResponse(result, 200);
      },
    },
  },
});
