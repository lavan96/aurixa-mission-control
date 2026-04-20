// Server-only core for cascade schedules. Two kinds:
//   - fleet_cascade: cascade prime → all clones with installed modules.
//   - module_sync:   bulk install + scoped cascade for a specific module.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { executeCascade } from "./cascade-engine.server";
import { bulkSyncModule } from "./module-sync.server";
import { nextCronTick } from "./cron";
import { unknownTable, type CascadeScheduleRow } from "./_phase3d-types";

type SupabaseLike = SupabaseClient<Database>;
type CascadeMode = Database["public"]["Enums"]["cascade_mode"];

export type ScheduleRunOutcome = {
  schedule_id: string;
  name: string;
  ok: boolean;
  cascade_event_id: string | null;
  error?: string;
};

export type RunDueResult = {
  ok: boolean;
  ran: number;
  outcomes: ScheduleRunOutcome[];
  error?: string;
};

export async function runScheduleNow(
  supabase: SupabaseLike,
  scheduleId: string,
  initiatedBy: string | null,
): Promise<ScheduleRunOutcome> {
  const { data, error } = await unknownTable(supabase, "cascade_schedules")
    .select("*")
    .eq("id", scheduleId)
    .maybeSingle();
  if (error || !data) {
    return {
      schedule_id: scheduleId,
      name: "(unknown)",
      ok: false,
      cascade_event_id: null,
      error: (error?.message as string) ?? "Schedule not found",
    };
  }
  return executeOne(supabase, data as CascadeScheduleRow, initiatedBy);
}

export async function runDueSchedules(supabase: SupabaseLike): Promise<RunDueResult> {
  const now = new Date().toISOString();
  const { data, error } = await unknownTable(supabase, "cascade_schedules")
    .select("*")
    .eq("enabled", true)
    .or(`next_run_at.is.null,next_run_at.lte.${now}`);
  if (error) return { ok: false, ran: 0, outcomes: [], error: error.message as string };
  const due = (data ?? []) as CascadeScheduleRow[];
  if (due.length === 0) return { ok: true, ran: 0, outcomes: [] };

  const outcomes: ScheduleRunOutcome[] = [];
  for (const s of due) {
    outcomes.push(await executeOne(supabase, s, null));
  }
  return { ok: true, ran: outcomes.length, outcomes };
}

async function executeOne(
  supabase: SupabaseLike,
  sched: CascadeScheduleRow,
  initiatedBy: string | null,
): Promise<ScheduleRunOutcome> {
  const startedAt = new Date().toISOString();
  let outcome: ScheduleRunOutcome;
  try {
    if (sched.kind === "fleet_cascade") {
      outcome = await runFleetCascade(supabase, sched, initiatedBy);
    } else {
      outcome = await runModuleSyncSchedule(supabase, sched, initiatedBy);
    }
  } catch (e) {
    outcome = {
      schedule_id: sched.id,
      name: sched.name,
      ok: false,
      cascade_event_id: null,
      error: e instanceof Error ? e.message : "Schedule run failed",
    };
  }

  const next = nextCronTick(sched.cron_expression, new Date());
  await unknownTable(supabase, "cascade_schedules")
    .update({
      last_run_at: startedAt,
      next_run_at: next ? next.toISOString() : null,
      last_cascade_event_id: outcome.cascade_event_id,
    })
    .eq("id", sched.id);

  await supabase.from("audit_log").insert({
    action: "schedule.executed",
    entity_type: "cascade_schedule",
    entity_id: sched.id,
    actor_user_id: initiatedBy,
    metadata: {
      kind: sched.kind,
      cron: sched.cron_expression,
      ok: outcome.ok,
      error: outcome.error ?? null,
      cascade_event_id: outcome.cascade_event_id,
    },
  });

  return outcome;
}

async function runFleetCascade(
  supabase: SupabaseLike,
  sched: CascadeScheduleRow,
  initiatedBy: string | null,
): Promise<ScheduleRunOutcome> {
  const { data: clones, error: clonesErr } = await supabase.from("clones").select("id");
  if (clonesErr) {
    return {
      schedule_id: sched.id,
      name: sched.name,
      ok: false,
      cascade_event_id: null,
      error: clonesErr.message,
    };
  }
  if (!clones || clones.length === 0) {
    return {
      schedule_id: sched.id,
      name: sched.name,
      ok: false,
      cascade_event_id: null,
      error: "No clones registered",
    };
  }

  const { data: ev, error: evErr } = await supabase
    .from("cascade_events")
    .insert({
      trigger: "scheduled",
      mode: sched.mode,
      status: "pending",
      scope_filter: {
        scope: "scheduled_fleet",
        schedule_id: sched.id,
        schedule_name: sched.name,
      },
      summary: `Scheduled · ${sched.name}`,
      initiated_by: initiatedBy,
    })
    .select()
    .single();
  if (evErr || !ev) {
    return {
      schedule_id: sched.id,
      name: sched.name,
      ok: false,
      cascade_event_id: null,
      error: evErr?.message ?? "Event insert failed",
    };
  }

  await supabase.from("cascade_results").insert(
    clones.map((c) => ({
      cascade_event_id: ev.id,
      clone_id: c.id,
      status: "queued" as const,
    })),
  );

  const res = await executeCascade(supabase, ev.id);
  return {
    schedule_id: sched.id,
    name: sched.name,
    ok: res.ok,
    cascade_event_id: ev.id,
    error: res.ok ? undefined : res.error,
  };
}

async function runModuleSyncSchedule(
  supabase: SupabaseLike,
  sched: CascadeScheduleRow,
  initiatedBy: string | null,
): Promise<ScheduleRunOutcome> {
  const sf = (sched.scope_filter ?? {}) as {
    module_id?: string;
    clone_ids?: string[] | "all";
  };
  const moduleId = sf.module_id;
  if (!moduleId) {
    return {
      schedule_id: sched.id,
      name: sched.name,
      ok: false,
      cascade_event_id: null,
      error: "scope_filter.module_id missing",
    };
  }

  let cloneIds: string[];
  if (sf.clone_ids && sf.clone_ids !== "all" && Array.isArray(sf.clone_ids)) {
    cloneIds = sf.clone_ids;
  } else {
    const { data: cm } = await supabase
      .from("clone_modules")
      .select("clone_id")
      .eq("module_id", moduleId);
    cloneIds = (cm ?? []).map((r) => r.clone_id);
  }

  if (cloneIds.length === 0) {
    return {
      schedule_id: sched.id,
      name: sched.name,
      ok: false,
      cascade_event_id: null,
      error: "No clones target this module",
    };
  }

  const res = await bulkSyncModule({
    supabase,
    moduleId,
    cloneIds,
    action: "install",
    cascade: true,
    cascadeMode: sched.mode as CascadeMode,
    initiatedBy,
  });
  return {
    schedule_id: sched.id,
    name: sched.name,
    ok: res.ok,
    cascade_event_id: res.cascade_event_id,
    error: res.ok ? undefined : res.error,
  };
}
