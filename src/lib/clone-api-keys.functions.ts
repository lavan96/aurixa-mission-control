import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { generateApiKey } from "@/server/clone-api-keys.server";

export const listCloneApiKeys = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ cloneId: z.string().uuid().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("clone_api_keys")
      .select(
        "id, clone_id, label, key_prefix, scopes, revoked_at, last_used_at, created_at, clones:clone_id(id, name, slug)",
      )
      .order("created_at", { ascending: false });
    if (data.cloneId) q = q.eq("clone_id", data.cloneId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { keys: rows ?? [] };
  });

export const createCloneApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        cloneId: z.string().uuid(),
        label: z.string().min(1).max(120),
        scopes: z.array(z.string().min(1).max(64)).min(1).max(10).default(["tokens:meter"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { raw, hash, prefix } = generateApiKey();
    const { error } = await supabaseAdmin.from("clone_api_keys").insert({
      clone_id: data.cloneId,
      label: data.label,
      scopes: data.scopes,
      key_hash: hash,
      key_prefix: prefix,
      created_by: context.userId,
    });
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, key: raw, prefix };
  });

export const revokeCloneApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin
      .from("clone_api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });
