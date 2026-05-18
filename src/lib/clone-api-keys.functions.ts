import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { generateApiKey } from "@/server/clone-api-keys.server";
import { fireTokenWebhook } from "@/server/token-webhooks.server";

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
        cloneId: z.string().uuid().nullable().optional(),
        label: z.string().min(1).max(120),
        scopes: z.array(z.string().min(1).max(64)).min(1).max(10).default(["tokens:meter"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { raw, hash, prefix } = generateApiKey();
    const { error } = await supabaseAdmin.from("clone_api_keys").insert({
      clone_id: data.cloneId ?? null,
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
    const { data: key } = await supabaseAdmin
      .from("clone_api_keys")
      .select("id, clone_id, label, key_prefix")
      .eq("id", data.id)
      .maybeSingle();
    const { error } = await supabaseAdmin
      .from("clone_api_keys")
      .update({ revoked_at: new Date().toISOString(), revoke_at: null })
      .eq("id", data.id);
    if (error) return { ok: false as const, error: error.message };
    if (key) {
      void fireTokenWebhook(
        "tokens.key.revoked",
        { key_id: key.id, key_prefix: key.key_prefix, label: key.label },
        key.clone_id,
      );
    }
    return { ok: true as const };
  });

export const rotateCloneApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        oldKeyId: z.string().uuid(),
        graceHours: z.number().int().min(0).max(24 * 30).default(24),
        label: z.string().min(1).max(120).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: old, error: oldErr } = await supabaseAdmin
      .from("clone_api_keys")
      .select("id, clone_id, label, scopes")
      .eq("id", data.oldKeyId)
      .maybeSingle();
    if (oldErr) return { ok: false as const, error: oldErr.message };
    if (!old) return { ok: false as const, error: "Original key not found" };

    const { raw, hash, prefix } = generateApiKey();
    const insert = await supabaseAdmin
      .from("clone_api_keys")
      .insert({
        clone_id: old.clone_id,
        label: data.label ?? `${old.label ?? "key"} (rotated)`,
        scopes: old.scopes,
        key_hash: hash,
        key_prefix: prefix,
        created_by: context.userId,
        rotated_from: old.id,
      })
      .select("id")
      .single();
    if (insert.error) return { ok: false as const, error: insert.error.message };

    const newId = insert.data.id;
    const revokeAt = new Date(Date.now() + data.graceHours * 3600_000).toISOString();
    await supabaseAdmin
      .from("clone_api_keys")
      .update({ rotated_to: newId, revoke_at: revokeAt })
      .eq("id", old.id);

    void fireTokenWebhook(
      "tokens.key.rotated",
      {
        old_key_id: old.id,
        new_key_id: newId,
        new_key_prefix: prefix,
        revoke_at: revokeAt,
        grace_hours: data.graceHours,
      },
      old.clone_id,
    );

    return { ok: true as const, key: raw, prefix, newId, revokeAt };
  });
