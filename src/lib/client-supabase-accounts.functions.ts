// @ts-nocheck
// E3 — Client-owned Supabase account records. Stores the client's org id
// and (encrypted) Personal Access Token so the handoff orchestrator can
// provision a twin project in *their* org (round 2). PAT is encrypted at
// rest via CREDENTIALS_ENC_KEY (see crypto.server.ts) and never returned
// to the client — only pat_last4 is exposed.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "@/integrations/supabase/role-middleware";

const createSchema = z.object({
  clone_id: z.string().uuid().nullable().optional(),
  owner_email: z.string().email(),
  owner_name: z.string().nullable().optional(),
  org_slug: z.string().nullable().optional(),
  org_id: z.string().nullable().optional(),
  plan_tier: z.string().nullable().optional(),
  region_allowed: z.array(z.string()).default([]),
  notes: z.string().nullable().optional(),
  pat: z.string().min(20).nullable().optional(),
});

export const listClientSupabaseAccounts = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("client_supabase_accounts")
      .select(
        "id, clone_id, owner_email, owner_name, org_slug, org_id, plan_tier, region_allowed, pat_last4, verified_at, revoked_at, created_at",
      )
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

export const createClientSupabaseAccount = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input) => createSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { encryptSecret } = await import("@/server/crypto.server");
    const patEnc = data.pat ? encryptSecret(data.pat) : null;
    const last4 = data.pat ? data.pat.slice(-4) : null;
    const { data: row, error } = await context.supabase
      .from("client_supabase_accounts")
      .insert({
        clone_id: data.clone_id ?? null,
        owner_email: data.owner_email,
        owner_name: data.owner_name ?? null,
        org_slug: data.org_slug ?? null,
        org_id: data.org_id ?? null,
        plan_tier: data.plan_tier ?? null,
        region_allowed: data.region_allowed,
        notes: data.notes ?? null,
        pat_last4: last4,
        // Store encrypted PAT in metadata JSONB for now; a future migration
        // moves it to a dedicated bytea column once vault-backed storage is
        // wired. Keeping it here avoids a second migration this round.
        // The record itself is admin-only via RLS.
        pat_ciphertext: null,
      })
      .select("id, owner_email")
      .single();
    if (error) throw error;
    if (patEnc) {
      // Stash encrypted PAT via a service-role write to avoid RLS quirks
      // with bytea. Because BYTEA needs an admin path.
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin
        .from("client_supabase_accounts")
        .update({ pat_ciphertext: Buffer.from(patEnc, "utf8") })
        .eq("id", row.id);
    }
    return { ok: true as const, id: row.id };
  });

export const revokeClientSupabaseAccount = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("client_supabase_accounts")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true as const };
  });
