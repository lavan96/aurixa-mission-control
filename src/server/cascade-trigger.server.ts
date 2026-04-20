// Server-only helper that creates a cascade_event + queued cascade_results
// for every clone. Used both by the user-facing trigger flow (via a server fn)
// and by the GitHub webhook receiver when prime is pushed.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

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
}): Promise<{ eventId: string | null; cloneCount: number; error?: string }> {
  const { supabase, mode, trigger, sourceBranch, sourceSha, initiatedBy, summary } = args;

  const { data: clones, error: cloneErr } = await supabase
    .from("clones")
    .select("id");
  if (cloneErr) return { eventId: null, cloneCount: 0, error: cloneErr.message };
  if (!clones || clones.length === 0) {
    return { eventId: null, cloneCount: 0, error: "No clones registered" };
  }

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
    })
    .select()
    .single();
  if (eventErr || !event) {
    return { eventId: null, cloneCount: 0, error: eventErr?.message ?? "Event insert failed" };
  }

  const rows = clones.map((c) => ({
    cascade_event_id: event.id,
    clone_id: c.id,
    status: "queued" as const,
  }));
  const { error: resErr } = await supabase.from("cascade_results").insert(rows);
  if (resErr) {
    return { eventId: event.id, cloneCount: 0, error: resErr.message };
  }

  return { eventId: event.id, cloneCount: clones.length };
}
