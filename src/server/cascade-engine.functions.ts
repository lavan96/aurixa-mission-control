import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { executeCascade } from "./cascade-engine.server";

// User-facing wrapper around the cascade engine. The webhook receiver and
// other server-only callers should import executeCascade directly instead.
export const runCascade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { cascadeEventId: string }) => {
    if (!data?.cascadeEventId || typeof data.cascadeEventId !== "string") {
      throw new Error("cascadeEventId required");
    }
    return data;
  })
  .handler(async ({ data, context }) => {
    return executeCascade(context.supabase, data.cascadeEventId);
  });
