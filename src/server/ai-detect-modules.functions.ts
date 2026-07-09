// @ts-nocheck
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

// Delete a single detection run + its drift alerts + import edges.
// Modules created by the run are NOT deleted — they are unlinked
// (detection_run_id set to null) so curated modules survive history cleanup.
export const deleteDetectionRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { runId: string }) => {
    if (!data?.runId) throw new Error("runId required");
    return data;
  })
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;

    // Unlink modules so we don't violate FK constraints.
    await supabase
      .from("modules")
      .update({ detection_run_id: null })
      .eq("detection_run_id", data.runId);

    // Cascade-style cleanup of dependent rows.
    await supabase.from("module_drift_alerts").delete().eq("detection_run_id", data.runId);
    await supabase.from("module_import_edges").delete().eq("detection_run_id", data.runId);

    // Clear back-pointer from any later runs that reference this one.
    await supabase
      .from("module_detection_runs")
      .update({ previous_run_id: null })
      .eq("previous_run_id", data.runId);

    const { error } = await supabase.from("module_detection_runs").delete().eq("id", data.runId);
    if (error) return { ok: false as const, error: error.message };

    await supabase.from("audit_log").insert({
      action: "detection_run.delete",
      actor_user_id: context.userId,
      entity_type: "module_detection_run",
      entity_id: data.runId,
      metadata: {},
    });

    return { ok: true as const };
  });

// Bulk-clear detection history. Optionally keep the most recent N runs.
export const clearDetectionHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data?: { keepLatest?: number; onlyFailed?: boolean }) => data ?? {})
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const keepLatest = Math.max(0, data.keepLatest ?? 0);
    const onlyFailed = data.onlyFailed ?? false;

    let query = supabase
      .from("module_detection_runs")
      .select("id, status, created_at")
      .order("created_at", { ascending: false });
    if (onlyFailed) query = query.eq("status", "failed");

    const { data: rows, error } = await query;
    if (error) return { ok: false as const, error: error.message, deleted: 0 };

    const targets = (rows ?? []).slice(keepLatest).map((r) => r.id as string);
    if (targets.length === 0) return { ok: true as const, deleted: 0 };

    await supabase
      .from("modules")
      .update({ detection_run_id: null })
      .in("detection_run_id", targets);
    await supabase.from("module_drift_alerts").delete().in("detection_run_id", targets);
    await supabase.from("module_import_edges").delete().in("detection_run_id", targets);
    await supabase
      .from("module_detection_runs")
      .update({ previous_run_id: null })
      .in("previous_run_id", targets);

    const { error: delErr } = await supabase
      .from("module_detection_runs")
      .delete()
      .in("id", targets);
    if (delErr) return { ok: false as const, error: delErr.message, deleted: 0 };

    await supabase.from("audit_log").insert({
      action: "detection_run.clear",
      actor_user_id: context.userId,
      entity_type: "module_detection_run",
      metadata: { count: targets.length, keep_latest: keepLatest, only_failed: onlyFailed },
    });

    return { ok: true as const, deleted: targets.length };
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
    (data: {
      moduleIds: string[];
      status: "approved" | "archived" | "rejected";
      rejectionReason?: string;
    }) => {
      if (!Array.isArray(data?.moduleIds) || data.moduleIds.length === 0)
        throw new Error("moduleIds required");
      if (!["approved", "archived", "rejected"].includes(data.status))
        throw new Error("status must be approved, archived, or rejected");
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
  .inputValidator((data: { moduleIds: string[]; cloneIds: string[]; cascadeMode?: string }) => {
    if (!Array.isArray(data?.moduleIds) || data.moduleIds.length === 0)
      throw new Error("moduleIds required");
    if (!Array.isArray(data?.cloneIds) || data.cloneIds.length === 0)
      throw new Error("cloneIds required");
    return data;
  })
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
      mode: (data.cascadeMode === "auto_merge"
        ? "auto_merge"
        : "pr") as Database["public"]["Enums"]["cascade_mode"],
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
    const { error: resErr } = await context.supabase.from("cascade_results").insert(results);
    if (resErr) return { ok: false as const, error: resErr.message };

    // Create tracking job
    const { error: jobErr } = await context.supabase.from("module_cascade_jobs").insert({
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
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
        coInstallation: [],
        healthScores: [],
      };
    }
  });

// ─── Module Library ─────────────────────────────────────────────────

// Publish approved modules to the library
export const publishToLibrary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { moduleIds: string[]; tags?: string[] }) => {
    if (!Array.isArray(data?.moduleIds) || data.moduleIds.length === 0)
      throw new Error("moduleIds required");
    return data;
  })
  .handler(async ({ data, context }) => {
    // Fetch the modules
    const { data: modules, error: fetchErr } = await context.supabase
      .from("modules")
      .select("*")
      .in("id", data.moduleIds);
    if (fetchErr || !modules)
      return { ok: false as const, error: fetchErr?.message ?? "Failed to fetch modules" };

    let published = 0;
    for (const m of modules) {
      // Mark previous versions as not latest
      await context.supabase
        .from("module_library")
        .update({ is_latest: false })
        .eq("slug", m.slug)
        .eq("is_latest", true);

      // Get next version
      const { data: prevVersions } = await context.supabase
        .from("module_library")
        .select("version")
        .eq("slug", m.slug)
        .order("version", { ascending: false })
        .limit(1);
      const nextVersion = ((prevVersions?.[0]?.version as number) ?? 0) + 1;

      const { error: insertErr } = await context.supabase.from("module_library").insert({
        name: m.name,
        slug: m.slug,
        description: m.description,
        route_path: (m.routes as string[])?.[0] ?? null,
        entry_file: m.route_entry_file ?? m.slug,
        file_paths: m.resolved_files ?? m.file_globs ?? [],
        file_count:
          (m.resolved_files as string[])?.length ?? (m.file_globs as string[])?.length ?? 0,
        version: nextVersion,
        source_detection_run_id: m.detection_run_id,
        source_module_id: m.id,
        published_by: context.userId,
        is_latest: true,
        tags: data.tags ?? [],
        metadata: {
          cohesion_score: m.cohesion_score,
          coupling_score: m.coupling_score,
          ai_confidence: m.ai_confidence,
          ai_reasoning: m.ai_reasoning,
          shared_by_modules: m.shared_by_modules,
        },
      });
      if (!insertErr) published++;
    }

    await context.supabase.from("audit_log").insert({
      action: "module.publish_to_library",
      entity_type: "module_library",
      actor_user_id: context.userId,
      metadata: { module_ids: data.moduleIds, published, tags: data.tags },
    });

    return { ok: true as const, published };
  });

// Get library entries
export const getModuleLibrary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data?: { latestOnly?: boolean; slug?: string }) => data ?? {})
  .handler(async ({ data, context }) => {
    let query = context.supabase
      .from("module_library")
      .select("*")
      .order("name", { ascending: true })
      .order("version", { ascending: false });

    if (data.latestOnly !== false) query = query.eq("is_latest", true);
    if (data.slug) query = query.eq("slug", data.slug);

    const { data: entries, error } = await query.limit(200);
    if (error) return { ok: false as const, error: error.message, entries: [] };
    return { ok: true as const, entries: entries ?? [] };
  });

// Remove library entry
export const removeFromLibrary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { entryId: string }) => {
    if (!data?.entryId) throw new Error("entryId required");
    return data;
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("module_library").delete().eq("id", data.entryId);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });