// Per-clone AI auto-apply rules. After analyzeCloneDrift produces fresh
// suggestions, this engine inspects the active policy and auto-applies the
// safest open suggestions (up to max_per_run) by spawning scoped cascade
// events — same mechanism the manual Apply button uses.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { executeCascade } from "./cascade-engine.server";
import { unknownTable, type CloneDriftPolicyRow, type DriftSeverity } from "./_phase3d-types";

type SupabaseLike = SupabaseClient<Database>;
type CascadeMode = Database["public"]["Enums"]["cascade_mode"];

export type AppliedAuto = {
  suggestion_id: string;
  cascade_event_id: string;
  summary: string;
};

export type AutoApplyResult = {
  ok: boolean;
  applied: AppliedAuto[];
  skipped_reason?: string;
};

const SEVERITY_RANK: Record<DriftSeverity, number> = { low: 0, medium: 1, high: 2 };

type Suggestion = {
  id: string;
  status: "open" | "applied" | "dismissed";
  recommended_mode: CascadeMode;
  summary: string;
  files: string[];
  risk: DriftSeverity;
  category: string;
  applied_event_id?: string | null;
};

export async function applyAutoPoliciesForClone(
  supabase: SupabaseLike,
  cloneId: string,
): Promise<AutoApplyResult> {
  const { data: policyData } = await unknownTable(supabase, "clone_drift_policies")
    .select("*")
    .eq("clone_id", cloneId)
    .maybeSingle();
  const policy = policyData as CloneDriftPolicyRow | null;
  if (!policy || !policy.enabled) {
    return { ok: true, applied: [], skipped_reason: "no policy or disabled" };
  }

  const { data: clone } = await supabase
    .from("clones")
    .select("drift_suggestions")
    .eq("id", cloneId)
    .maybeSingle();
  if (!clone) return { ok: false, applied: [], skipped_reason: "clone not found" };

  const all = (clone.drift_suggestions as unknown as Suggestion[] | null) ?? [];
  const threshold = SEVERITY_RANK[policy.auto_apply_severity];
  const muted = new Set(policy.muted_kinds ?? []);

  const eligible = all.filter(
    (s) =>
      s.status === "open" &&
      SEVERITY_RANK[s.risk] <= threshold &&
      !muted.has(s.category),
  );
  if (eligible.length === 0) {
    return { ok: true, applied: [], skipped_reason: "no eligible suggestions" };
  }

  eligible.sort((a, b) => SEVERITY_RANK[a.risk] - SEVERITY_RANK[b.risk]);
  const batch = eligible.slice(0, Math.max(1, policy.max_per_run));

  const applied: AppliedAuto[] = [];
  let working = [...all];

  for (const s of batch) {
    const { data: ev, error: evErr } = await supabase
      .from("cascade_events")
      .insert({
        trigger: "scheduled",
        mode: policy.cascade_mode,
        status: "pending",
        scope_filter: {
          scope: "ai_suggestion",
          clone_ids: [cloneId],
          suggestion_id: s.id,
          summary: s.summary,
          auto_applied: true,
        },
        summary: `Auto-applied · ${s.summary}`,
        initiated_by: null,
      })
      .select()
      .single();
    if (evErr || !ev) continue;

    await supabase.from("cascade_results").insert({
      cascade_event_id: ev.id,
      clone_id: cloneId,
      status: "queued" as const,
    });

    working = working.map((x) =>
      x.id === s.id
        ? { ...x, status: "applied" as const, applied_event_id: ev.id }
        : x,
    );

    const res = await executeCascade(supabase, ev.id);
    if (res.ok) {
      applied.push({ suggestion_id: s.id, cascade_event_id: ev.id, summary: s.summary });
    }
  }

  if (applied.length > 0) {
    await supabase
      .from("clones")
      .update({
        drift_suggestions:
          working as unknown as Database["public"]["Tables"]["clones"]["Update"]["drift_suggestions"],
      })
      .eq("id", cloneId);

    await unknownTable(supabase, "clone_drift_policies")
      .update({
        last_applied_at: new Date().toISOString(),
        last_applied_count: applied.length,
      })
      .eq("clone_id", cloneId);

    await supabase.from("audit_log").insert({
      action: "drift.auto_applied",
      entity_type: "clone",
      entity_id: cloneId,
      metadata: {
        applied: applied.length,
        severity_threshold: policy.auto_apply_severity,
        cascade_mode: policy.cascade_mode,
        cascade_event_ids: applied.map((a) => a.cascade_event_id),
      },
    });
  }

  return { ok: true, applied };
}
