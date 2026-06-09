// Drift scan: compare every assignment's applied_config_hash to its
// profile's current config_hash. Cron-callable. Pure read + status update —
// does NOT auto-reapply. Use a `brand_sync` schedule with `clone_ids:"drifted"`
// for that.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { BrandDriftScanResult } from "./types";

type SupabaseLike = SupabaseClient<Database>;

export async function runBrandDriftScan(supabase: SupabaseLike): Promise<BrandDriftScanResult> {
  const { data: rows, error } = await supabase
    .from("clone_brand_assignments")
    .select(
      "clone_id, profile_id, applied_config_hash, status, clone_brand_profiles(config_hash, status, name)",
    );
  if (error) {
    return { scanned: 0, drifted: 0, reapplied: 0, failures: 1, details: [] };
  }

  type Row = {
    clone_id: string;
    profile_id: string;
    applied_config_hash: string | null;
    status: Database["public"]["Enums"]["brand_assignment_status"];
    clone_brand_profiles: {
      config_hash: string | null;
      status: Database["public"]["Enums"]["brand_profile_status"];
      name: string;
    } | null;
  };

  const driftedIds: string[] = [];
  const details: BrandDriftScanResult["details"] = [];
  for (const r of (rows ?? []) as Row[]) {
    const profileHash = r.clone_brand_profiles?.config_hash ?? null;
    const profileStatus = r.clone_brand_profiles?.status ?? null;
    if (profileStatus !== "published") continue;

    let reason: string | null = null;
    if (!r.applied_config_hash) reason = "Never applied";
    else if (profileHash && profileHash !== r.applied_config_hash)
      reason = "Profile updated since last apply";

    if (reason && r.status !== "drifted" && r.status !== "pending") {
      driftedIds.push(r.clone_id);
      details.push({
        cloneId: r.clone_id,
        profileId: r.profile_id,
        reason,
        reapplied: false,
      });
    }
  }

  if (driftedIds.length > 0) {
    await supabase
      .from("clone_brand_assignments")
      .update({
        status: "drifted",
        last_drift_check_at: new Date().toISOString(),
        drift_summary: "Detected by automated drift scan",
      })
      .in("clone_id", driftedIds);

    await supabase.from("notifications").insert({
      kind: "drift_medium",
      severity: "warning",
      title: `Brand drift detected · ${driftedIds.length} clone(s)`,
      body: `${driftedIds.length} clone(s) have brand profile updates pending application.`,
      url: "/branding",
      metadata: {
        scope: "brand_drift_scan",
        drifted_count: driftedIds.length,
      },
    });
  }

  return {
    scanned: rows?.length ?? 0,
    drifted: driftedIds.length,
    reapplied: 0,
    failures: 0,
    details,
  };
}
