// Pure, isomorphic blast-radius assessment. Lives in /lib (not /server) so
// route components can import it without dragging server-only code into the
// client bundle. Server modules re-export this from cascade-approvals.server.
import type { Database } from "@/integrations/supabase/types";

export const HIGH_RISK_CLONE_COUNT = 10;
export const AUTO_MERGE_THRESHOLD = 3;

export type BlastAssessment = {
  cloneCount: number;
  requiresApproval: boolean;
  reason: string | null;
};

/**
 * Decide whether a cascade event of the given mode targeting `cloneCount`
 * clones must wait for a second operator's approval. Used by the cascade
 * form, the engine, schedules, drift policies, and module-sync.
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
