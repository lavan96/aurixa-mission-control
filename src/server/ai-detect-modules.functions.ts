import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  runDetection,
  analyzeModuleIntelligence,
  DEFAULT_CONFIG,
  type DetectionStrategy,
  type DetectionRunConfig,
} from "./module-detection.server";

// Enhanced multi-pass AI module detection
export const detectModules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data?: {
      strategy?: DetectionStrategy;
      maxModules?: number;
      minModules?: number;
      sampleFileContent?: boolean;
      analyzeImports?: boolean;
      deltaMode?: boolean;
    }) => data ?? {},
  )
  .handler(async ({ data, context }) => {
    const config: DetectionRunConfig = {
      strategy: data.strategy ?? DEFAULT_CONFIG.strategy,
      maxModules: data.maxModules ?? DEFAULT_CONFIG.maxModules,
      minModules: data.minModules ?? DEFAULT_CONFIG.minModules,
      sampleFileContent: data.sampleFileContent ?? DEFAULT_CONFIG.sampleFileContent,
      analyzeImports: data.analyzeImports ?? DEFAULT_CONFIG.analyzeImports,
      deltaMode: data.deltaMode ?? DEFAULT_CONFIG.deltaMode,
    };

    return runDetection({
      supabase: context.supabase,
      userId: context.userId,
      config,
    });
  });

// Fetch detection run history
export const getDetectionRuns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("module_detection_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) return { ok: false as const, error: error.message, runs: [] };
    return { ok: true as const, runs: data ?? [] };
  });

// Fetch import graph for a detection run
export const getImportGraph = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { runId: string }) => {
    if (!data?.runId) throw new Error("runId required");
    return data;
  })
  .handler(async ({ data, context }) => {
    const { data: edges, error } = await context.supabase
      .from("module_import_edges")
      .select("*")
      .eq("detection_run_id", data.runId)
      .limit(500);
    if (error) return { ok: false as const, error: error.message, edges: [] };
    return { ok: true as const, edges: edges ?? [] };
  });

// Fetch drift alerts
export const getDriftAlerts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data?: { runId?: string; resolved?: boolean }) => data ?? {})
  .handler(async ({ data, context }) => {
    let query = context.supabase
      .from("module_drift_alerts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (data.runId) query = query.eq("detection_run_id", data.runId);
    if (data.resolved !== undefined) query = query.eq("resolved", data.resolved);
    const { data: alerts, error } = await query;
    if (error) return { ok: false as const, error: error.message, alerts: [] };
    return { ok: true as const, alerts: alerts ?? [] };
  });

// Resolve a drift alert
export const resolveDriftAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { alertId: string }) => {
    if (!data?.alertId) throw new Error("alertId required");
    return data;
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("module_drift_alerts")
      .update({
        resolved: true,
        resolved_at: new Date().toISOString(),
        resolved_by: context.userId,
      })
      .eq("id", data.alertId);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

// Batch approve/reject/archive modules
export const batchUpdateModuleStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { moduleIds: string[]; status: "approved" | "archived" | "rejected"; rejectionReason?: string }) => {
      if (!Array.isArray(data?.moduleIds) || data.moduleIds.length === 0) throw new Error("moduleIds required");
      if (!["approved", "archived", "rejected"].includes(data.status)) throw new Error("status must be approved, archived, or rejected");
      return data;
    },
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("modules")
      .update({
        status: data.status,
        approved_by: data.status === "approved" ? context.userId : null,
        approved_at: data.status === "approved" ? new Date().toISOString() : null,
        rejection_reason: data.status === "rejected" ? (data.rejectionReason ?? null) : null,
      })
      .in("id", data.moduleIds);
    if (error) return { ok: false as const, error: error.message };

    await context.supabase.from("audit_log").insert({
      action: `module.batch_${data.status}`,
      entity_type: "module",
      actor_user_id: context.userId,
      metadata: {
        module_ids: data.moduleIds,
        count: data.moduleIds.length,
        status: data.status,
        rejection_reason: data.rejectionReason,
      },
    });

    return { ok: true as const, count: data.moduleIds.length };
  });

// Approve modules and optionally trigger cascade deploy
export const approveAndDeploy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { moduleIds: string[]; cloneIds: string[]; cascadeMode?: string }) => {
      if (!Array.isArray(data?.moduleIds) || data.moduleIds.length === 0) throw new Error("moduleIds required");
      if (!Array.isArray(data?.cloneIds) || data.cloneIds.length === 0) throw new Error("cloneIds required");
      return data;
    },
  )
  .handler(async ({ data, context }) => {
    // Approve modules first
    const { error: modErr } = await context.supabase
      .from("modules")
      .update({
        status: "approved",
        approved_by: context.userId,
        approved_at: new Date().toISOString(),
        rejection_reason: null,
      })
      .in("id", data.moduleIds);
    if (modErr) return { ok: false as const, error: modErr.message };

    // Create cascade event
    const insertRow: Database["public"]["Tables"]["cascade_events"]["Insert"] = {
      trigger: "manual",
      mode: (data.cascadeMode ?? "pr") as "pr" | "direct",
      status: "pending",
      initiated_by: context.userId,
      scope_filter: { module_ids: data.moduleIds },
      summary: `Module approval deploy: ${data.moduleIds.length} module(s) → ${data.cloneIds.length} clone(s)`,
    };
    const { data: event, error: evtErr } = await context.supabase
      .from("cascade_events")
      .insert(insertRow)
      .select("id")
      .single();
    if (evtErr) return { ok: false as const, error: evtErr.message };

    // Create cascade results for each clone
    const results = data.cloneIds.map((cloneId) => ({
      cascade_event_id: event.id,
      clone_id: cloneId,
      status: "queued" as const,
    }));
    const { error: resErr } = await context.supabase
      .from("cascade_results")
      .insert(results);
    if (resErr) return { ok: false as const, error: resErr.message };

    // Create tracking job
    const { error: jobErr } = await context.supabase
      .from("module_cascade_jobs")
      .insert({
        module_ids: data.moduleIds,
        clone_ids: data.cloneIds,
        cascade_event_id: event.id,
        status: "queued",
        initiated_by: context.userId,
        metadata: { cascade_mode: data.cascadeMode ?? "pr" },
      });
    if (jobErr) return { ok: false as const, error: jobErr.message };

    // Audit
    await context.supabase.from("audit_log").insert({
      action: "module.approve_and_deploy",
      entity_type: "cascade_event",
      entity_id: event.id,
      actor_user_id: context.userId,
      metadata: {
        module_ids: data.moduleIds,
        clone_ids: data.cloneIds,
        cascade_mode: data.cascadeMode ?? "pr",
      },
    });

    return { ok: true as const, cascadeEventId: event.id, count: data.moduleIds.length };
  });

// Get cascade deploy jobs
export const getModuleCascadeJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("module_cascade_jobs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) return { ok: false as const, error: error.message, jobs: [] };
    return { ok: true as const, jobs: data ?? [] };
  });

// Cross-clone module intelligence
export const getModuleIntelligence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const result = await analyzeModuleIntelligence(context.supabase);
      return { ok: true as const, ...result };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e), coInstallation: [], healthScores: [] };
    }
  });
