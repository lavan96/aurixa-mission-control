// Server-only helpers for the cascade approval gate.
// High-blast-radius cascades (>HIGH_RISK_CLONE_COUNT clones, or any auto_merge
// against >AUTO_MERGE_THRESHOLD clones) require a second operator to approve
// before the engine will run.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type SupabaseLike = SupabaseClient<Database>;

export const HIGH_RISK_CLONE_COUNT = 10;
export const AUTO_MERGE_THRESHOLD = 3;

export type BlastAssessment = {
  cloneCount: number;
  requiresApproval: boolean;
  reason: string | null;
};

/**
 * Decide whether a cascade event of the given mode targeting `cloneCount`
 * clones must wait for a second operator's approval. Encapsulated so both the
 * cascade form and the engine apply the same rule.
 */
export function assessBlastRadius(
  mode: Database["public"]["Enums"]["cascade_mode"],
  cloneCount: number,
): BlastAssessment {
  if (mode === "auto_merge" && cloneCount > AUTO_MERGE_THRESHOLD) {
    return {
      cloneCount,
      requiresApproval: true,
      reason: `Auto-merge across ${cloneCount} clones (>${AUTO_MERGE_THRESHOLD}) requires a second operator.`,
    };
  }
  if (cloneCount > HIGH_RISK_CLONE_COUNT) {
    return {
      cloneCount,
      requiresApproval: true,
      reason: `Cascade against ${cloneCount} clones (>${HIGH_RISK_CLONE_COUNT}) requires a second operator.`,
    };
  }
  return { cloneCount, requiresApproval: false, reason: null };
}

/**
 * Returns true iff the event is currently blocked waiting for a second-operator
 * approval. Used by the engine to short-circuit before doing any GitHub work.
 */
export async function isBlockedByApproval(
  supabase: SupabaseLike,
  cascadeEventId: string,
): Promise<{ blocked: boolean; reason?: string }> {
  const { data: ev } = await supabase
    .from("cascade_events")
    .select("requires_approval, approved_at")
    .eq("id", cascadeEventId)
    .maybeSingle();
  if (!ev) return { blocked: false };
  if (ev.requires_approval && !ev.approved_at) {
    return { blocked: true, reason: "Awaiting second-operator approval" };
  }
  return { blocked: false };
}
