// Server-only helper that creates a cascade_event + queued cascade_results
// for every clone. Used both by the user-facing trigger flow (via a server fn)
// and by the GitHub webhook receiver when prime is pushed.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { assessBlastRadius } from "./cascade-approvals.server";

type CascadeMode = Database["public"]["Enums"]["cascade_mode"];
type CascadeTrigger = Database["public"]["Enums"]["cascade_trigger"];
type SupabaseLike = SupabaseClient<Database>;

export async function createCascadeForAllClones(args: {
  supabase: SupabaseLike;
  mode: CascadeMode;
  trigger: CascadeTrigger;
  sourceBranch: string | null;
  sourceSha: string | null;
  initiatedBy: string | null;
  summary?: string | null;
}): Promise<{
  eventId: string | null;
  cloneCount: number;
  requiresApproval: boolean;
  error?: string;
}> {
  const { supabase, mode, trigger, sourceBranch, sourceSha, initiatedBy, summary } = args;

  const { data: clones, error: cloneErr } = await supabase.from("clones").select("id");
  if (cloneErr)
    return { eventId: null, cloneCount: 0, requiresApproval: false, error: cloneErr.message };
  if (!clones || clones.length === 0) {
    return { eventId: null, cloneCount: 0, requiresApproval: false, error: "No clones registered" };
  }

  const blast = assessBlastRadius(mode, clones.length);

  const { data: event, error: eventErr } = await supabase
    .from("cascade_events")
    .insert({
      mode,
      trigger,
      source_branch: sourceBranch,
      source_sha: sourceSha,
      initiated_by: initiatedBy,
      summary: summary ?? null,
      status: "pending",
      requires_approval: blast.requiresApproval,
    })
    .select()
    .single();
  if (eventErr || !event) {
    return {
      eventId: null,
      cloneCount: 0,
      requiresApproval: blast.requiresApproval,
      error: eventErr?.message ?? "Event insert failed",
    };
  }

  const rows = clones.map((c) => ({
    cascade_event_id: event.id,
    clone_id: c.id,
    status: "queued" as const,
  }));
  const { error: resErr } = await supabase.from("cascade_results").insert(rows);
  if (resErr) {
    return {
      eventId: event.id,
      cloneCount: 0,
      requiresApproval: blast.requiresApproval,
      error: resErr.message,
    };
  }

  if (blast.requiresApproval) {
    await supabase.from("notifications").insert({
      kind: "cascade_awaiting_approval",
      severity: "warning",
      title: `Approval needed · ${trigger} ${mode.replace("_", " ")} cascade`,
      body: blast.reason ?? "High-blast-radius cascade — awaiting second-operator approval.",
      cascade_event_id: event.id,
      url: `/cascades/${event.id}`,
      metadata: { mode, trigger, clone_count: clones.length },
    });
    await supabase.from("audit_log").insert({
      action: "cascade.awaiting_approval",
      entity_type: "cascade_event",
      entity_id: event.id,
      actor_user_id: initiatedBy,
      metadata: { mode, trigger, clone_count: clones.length, reason: blast.reason },
    });
  }

  return { eventId: event.id, cloneCount: clones.length, requiresApproval: blast.requiresApproval };
}
