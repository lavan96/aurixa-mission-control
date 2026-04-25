// Version history utilities. The trigger `snapshot_brand_version_on_publish`
// auto-creates a row whenever a profile transitions into `published` or
// republishes with a new hash. These helpers list / rollback.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type SupabaseLike = SupabaseClient<Database>;

export type BrandVersion = {
  id: string;
  profile_id: string;
  version: number;
  config_hash: string | null;
  brand_config: Record<string, unknown>;
  report_contact: Record<string, unknown>;
  asset_manifest: Array<Record<string, unknown>>;
  notes: string | null;
  published_by: string | null;
  published_at: string;
};

export async function listVersionsForProfile(
  supabase: SupabaseLike,
  profileId: string,
): Promise<BrandVersion[]> {
  const { data } = await supabase
    .from("clone_brand_versions")
    .select("*")
    .eq("profile_id", profileId)
    .order("version", { ascending: false });
  return (data ?? []) as unknown as BrandVersion[];
}

/**
 * Roll a profile back to a prior version. Copies the snapshot's payload
 * over the current profile row. The snapshot trigger then writes a NEW
 * version row (we never mutate history).
 */
export async function rollbackProfileToVersion(
  supabase: SupabaseLike,
  args: { profileId: string; versionId: string; actorUserId: string | null },
): Promise<{ ok: boolean; error?: string; newVersion?: number }> {
  const { data: snap, error: snapErr } = await supabase
    .from("clone_brand_versions")
    .select("*")
    .eq("id", args.versionId)
    .eq("profile_id", args.profileId)
    .maybeSingle();
  if (snapErr || !snap) return { ok: false, error: snapErr?.message ?? "Version not found" };

  const { data: updated, error: upErr } = await supabase
    .from("clone_brand_profiles")
    .update({
      brand_config: snap.brand_config,
      report_contact: snap.report_contact,
      asset_manifest: snap.asset_manifest,
      config_hash: snap.config_hash,
      published_at: new Date().toISOString(),
      published_by: args.actorUserId,
      status: "published",
    })
    .eq("id", args.profileId)
    .select("version")
    .maybeSingle();
  if (upErr) return { ok: false, error: upErr.message };

  return { ok: true, newVersion: updated?.version };
}
