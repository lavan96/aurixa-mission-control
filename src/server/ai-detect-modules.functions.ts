import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
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

// Batch approve/reject modules
export const batchUpdateModuleStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { moduleIds: string[]; status: "approved" | "archived" }) => {
      if (!Array.isArray(data?.moduleIds) || data.moduleIds.length === 0) throw new Error("moduleIds required");
      if (data.status !== "approved" && data.status !== "archived") throw new Error("status must be approved or archived");
      return data;
    },
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("modules")
      .update({ status: data.status })
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
      },
    });

    return { ok: true as const, count: data.moduleIds.length };
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
