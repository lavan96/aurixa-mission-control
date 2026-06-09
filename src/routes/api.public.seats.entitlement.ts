import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, resolveCloneApiKey } from "@/server/clone-api-keys.server";
import { ensureSeatEntitlement } from "@/server/seats.server";

export const Route = createFileRoute("/api/public/seats/entitlement")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const key = await resolveCloneApiKey(
          request.headers.get("x-clone-api-key"),
          "seats:manage",
        );
        if (!key) return jsonResponse({ ok: false, error: "unauthorized" }, 401);
        const snap = await ensureSeatEntitlement(key.clone_id);
        if (!snap) return jsonResponse({ ok: false, error: "no_entitlement" }, 404);
        return jsonResponse({ ok: true, ...snap });
      },
    },
  },
});
