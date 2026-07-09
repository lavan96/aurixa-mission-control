// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  getCloneApplicableMigrations,
  getAllMigrations,
  getLatestCloneMigrationId,
  getPendingMigrationCount,
  getPendingMigrations,
  applyPendingMigrations,
} from "./migration-replication.server";

/**
 * Get migration registry info — all migrations and their applicability.
 */
export const getMigrationRegistry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const all = getAllMigrations();
    const cloneApplicable = getCloneApplicableMigrations();
    const latestCloneVersion = getLatestCloneMigrationId();

    return {
      totalMigrations: all.length,
      cloneApplicable: cloneApplicable.length,
      latestCloneVersion,
      migrations: all,
    };
  });

/**
 * Get migration status for a specific clone backend.
 */
export const getCloneMigrationStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { cloneId: string }) => {
    if (!input?.cloneId?.trim()) throw new Error("cloneId is required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: backend } = await supabase
      .from("clone_backends")
      .select("supabase_project_ref, migration_version, status")
      .eq("clone_id", data.cloneId)
      .maybeSingle();

    if (!backend) {
      return { hasBackend: false as const };
    }

    const currentVersion = backend.migration_version;
    const pendingCount = getPendingMigrationCount(currentVersion);
    const pending = getPendingMigrations(currentVersion);
    const latestVersion = getLatestCloneMigrationId();

    return {
      hasBackend: true as const,
      backendStatus: backend.status,
      currentVersion,
      latestVersion,
      pendingCount,
      pendingMigrations: pending,
      isUpToDate: pendingCount === 0,
    };
  });

/**
 * Apply pending migrations to a specific clone backend.
 */
export const syncCloneMigrations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { cloneId: string }) => {
    if (!input?.cloneId?.trim()) throw new Error("cloneId is required");
    return input;
  })
  .handler(
    async ({
      data,
      context,
    }): Promise<
      | { ok: true; applied: number; newVersion: string; failures: string[] }
      | { ok: false; error: string }
    > => {
      const { supabase, userId } = context;

      // Verify admin
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "admin")
        .limit(1);
      if (!roles || roles.length === 0) {
        return { ok: false, error: "Only admins can sync migrations" };
      }

      const { data: backend } = await supabase
        .from("clone_backends")
        .select("supabase_project_ref, migration_version, status")
        .eq("clone_id", data.cloneId)
        .maybeSingle();

      if (!backend) {
        return { ok: false, error: "No backend provisioned for this clone" };
      }
      if (backend.status !== "ready") {
        return { ok: false, error: `Backend is not ready (status: ${backend.status})` };
      }
      if (!backend.supabase_project_ref) {
        return { ok: false, error: "Backend has no project reference" };
      }

      // Update status to migrating
      await supabase
        .from("clone_backends")
        .update({ status: "migrating" as const, status_detail: "Applying pending migrations..." })
        .eq("clone_id", data.cloneId);

      try {
        const { results, newVersion } = await applyPendingMigrations(
          backend.supabase_project_ref,
          backend.migration_version,
        );

        const successes = results.filter((r) => r.success);
        const failures = results.filter((r) => !r.success);

        // Update backend record
        await supabase
          .from("clone_backends")
          .update({
            migration_version: newVersion,
            status: failures.length > 0 ? ("failed" as const) : ("ready" as const),
            status_detail:
              failures.length > 0
                ? `Migration failed at ${failures[0].migrationId}: ${failures[0].error}`
                : `Migrations up to date (${newVersion})`,
            error_message: failures.length > 0 ? failures[0].error : null,
          })
          .eq("clone_id", data.cloneId);

        // Audit log
        await supabase.from("audit_log").insert({
          action: "clone_backend.migrations_synced",
          entity_type: "clone",
          entity_id: data.cloneId,
          actor_user_id: userId,
          metadata: {
            applied: successes.length,
            failed: failures.length,
            new_version: newVersion,
            failures: failures.map((f) => ({ id: f.migrationId, error: f.error })),
          },
        });

        return {
          ok: true,
          applied: successes.length,
          newVersion,
          failures: failures.map((f) => `${f.migrationId}: ${f.error}`),
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Migration sync failed";
        await supabase
          .from("clone_backends")
          .update({
            status: "ready" as const,
            status_detail: `Migration error: ${msg}`,
            error_message: msg,
          })
          .eq("clone_id", data.cloneId);
        return { ok: false, error: msg };
      }
    },
  );

/**
 * Fleet-wide migration sync: apply pending migrations to all ready clone backends.
 */
export const fleetMigrationSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<
      | {
          ok: true;
          results: { cloneId: string; cloneName: string; applied: number; failures: string[] }[];
        }
      | { ok: false; error: string }
    > => {
      const { supabase, userId } = context;

      // Verify admin
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "admin")
        .limit(1);
      if (!roles || roles.length === 0) {
        return { ok: false, error: "Only admins can run fleet migration sync" };
      }

      // Get all ready backends that are behind
      const { data: backends } = await supabase
        .from("clone_backends")
        .select("clone_id, supabase_project_ref, migration_version, status")
        .eq("status", "ready")
        .not("supabase_project_ref", "is", null);

      if (!backends || backends.length === 0) {
        return { ok: true, results: [] };
      }

      // Get clone names
      const cloneIds = backends.map((b) => b.clone_id);
      const { data: clones } = await supabase.from("clones").select("id, name").in("id", cloneIds);
      const cloneNameMap = new Map(clones?.map((c) => [c.id, c.name]) ?? []);

      const results: { cloneId: string; cloneName: string; applied: number; failures: string[] }[] =
        [];

      for (const backend of backends) {
        const pending = getPendingMigrationCount(backend.migration_version);
        if (pending === 0) continue;

        try {
          const { results: migResults, newVersion } = await applyPendingMigrations(
            backend.supabase_project_ref!,
            backend.migration_version,
          );

          const successes = migResults.filter((r) => r.success);
          const failures = migResults.filter((r) => !r.success);

          await supabase
            .from("clone_backends")
            .update({
              migration_version: newVersion,
              status: failures.length > 0 ? ("failed" as const) : ("ready" as const),
              status_detail:
                failures.length > 0
                  ? `Migration failed at ${failures[0].migrationId}`
                  : `Synced to ${newVersion}`,
              error_message: failures.length > 0 ? failures[0].error : null,
            })
            .eq("clone_id", backend.clone_id);

          results.push({
            cloneId: backend.clone_id,
            cloneName: cloneNameMap.get(backend.clone_id) ?? "Unknown",
            applied: successes.length,
            failures: failures.map((f) => `${f.migrationId}: ${f.error}`),
          });
        } catch (e) {
          results.push({
            cloneId: backend.clone_id,
            cloneName: cloneNameMap.get(backend.clone_id) ?? "Unknown",
            applied: 0,
            failures: [e instanceof Error ? e.message : "Unknown error"],
          });
        }
      }

      // Audit log
      await supabase.from("audit_log").insert({
        action: "fleet.migrations_synced",
        entity_type: "fleet",
        entity_id: null,
        actor_user_id: userId,
        metadata: {
          clones_processed: results.length,
          total_applied: results.reduce((s, r) => s + r.applied, 0),
          total_failures: results.reduce((s, r) => s + r.failures.length, 0),
        },
      });

      return { ok: true, results };
    },
  );