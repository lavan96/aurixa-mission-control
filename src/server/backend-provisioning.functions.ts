// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { provisionCloneBackend } from "./backend-provisioning.server";
import { encryptSecret } from "./crypto.server";

/**
 * Provision a dedicated Supabase backend for a clone.
 * Creates the project, runs migrations, seeds the admin user,
 * and stores credentials in clone_backends.
 */
export const provisionBackend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      cloneId: string;
      cloneName: string;
      region?: string;
      adminEmail: string;
      adminPassword: string;
      moduleIds?: string[];
    }) => {
      if (!input?.cloneId?.trim()) throw new Error("cloneId is required");
      if (!input?.cloneName?.trim()) throw new Error("cloneName is required");
      if (!input?.adminEmail?.trim()) throw new Error("adminEmail is required");
      if (!input?.adminPassword || input.adminPassword.length < 8) {
        throw new Error("adminPassword must be at least 8 characters");
      }
      return input;
    },
  )
  .handler(async ({ data, context }): Promise<{ ok: true } | { ok: false; error: string }> => {
    const { supabase, userId } = context;

    // Verify admin role
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .limit(1);

    if (!roles || roles.length === 0) {
      return { ok: false, error: "Only admins can provision backends" };
    }

    // Check if clone exists
    const { data: clone } = await supabase
      .from("clones")
      .select("id, name")
      .eq("id", data.cloneId)
      .single();

    if (!clone) {
      return { ok: false, error: "Clone not found" };
    }

    // Check for existing backend
    const { data: existing } = await supabase
      .from("clone_backends")
      .select("id, status")
      .eq("clone_id", data.cloneId)
      .maybeSingle();

    if (existing && existing.status === "ready") {
      return { ok: false, error: "This clone already has a provisioned backend" };
    }

    // Upsert a pending row
    const { error: upsertErr } = await supabase.from("clone_backends").upsert(
      {
        clone_id: data.cloneId,
        status: "pending" as const,
        region: data.region || "us-east-1",
        admin_email: data.adminEmail,
        error_message: null,
        status_detail: "Queued for provisioning",
      },
      { onConflict: "clone_id" },
    );

    if (upsertErr) {
      return { ok: false, error: upsertErr.message };
    }

    // Status update helper — writes progress to the DB
    const updateStatus = async (status: string, detail: string) => {
      await supabase
        .from("clone_backends")
        .update({
          status: status as "provisioning" | "migrating" | "seeding_admin",
          status_detail: detail,
        })
        .eq("clone_id", data.cloneId);
    };

    try {
      const result = await provisionCloneBackend(
        {
          cloneName: data.cloneName,
          region: data.region,
          adminEmail: data.adminEmail,
          adminPassword: data.adminPassword,
        },
        updateStatus,
      );

      // Store credentials and mark ready
      await supabase
        .from("clone_backends")
        .update({
          supabase_project_ref: result.projectRef,
          supabase_url: result.projectUrl,
          anon_key: result.anonKey,
          service_role_key: encryptSecret(result.serviceRoleKey),
          db_pass: encryptSecret(result.dbPass),
          status: "ready" as const,
          status_detail: "Backend is ready",
          migration_version: "bootstrap_v1",
          error_message: null,
        })
        .eq("clone_id", data.cloneId);

      // Step 6 — Apply per-module migrations for selected modules
      const moduleIds = data.moduleIds ?? [];
      const moduleApplyResults: Array<{ id: string; name: string; ok: boolean; error?: string }> =
        [];
      if (moduleIds.length > 0) {
        const { runSqlOnProject } = await import("./backend-provisioning.server");
        const { data: mods } = await supabase
          .from("modules")
          .select("id, name, clone_migration_sql, apply_on_install")
          .in("id", moduleIds);
        for (const m of mods ?? []) {
          const sql = (m.clone_migration_sql ?? "").trim();
          if (!sql || m.apply_on_install === false) continue;
          try {
            await runSqlOnProject(result.projectRef, sql);
            moduleApplyResults.push({ id: m.id, name: m.name, ok: true });
          } catch (e) {
            moduleApplyResults.push({
              id: m.id,
              name: m.name,
              ok: false,
              error: e instanceof Error ? e.message : "sql failed",
            });
          }
        }
      }


      const failedModules = moduleApplyResults.filter((r) => !r.ok);

      // Audit log
      await supabase.from("audit_log").insert({
        action: "clone_backend.provisioned",
        entity_type: "clone",
        entity_id: data.cloneId,
        actor_user_id: userId,
        metadata: {
          project_ref: result.projectRef,
          region: data.region || "us-east-1",
          admin_email: data.adminEmail,
          module_migrations: moduleApplyResults,
        },
      });

      // Notification
      await supabase.from("notifications").insert({
        kind: "clone_created" as const,
        severity: failedModules.length > 0 ? ("warning" as const) : ("success" as const),
        title: `Backend provisioned: ${clone.name}`,
        body:
          failedModules.length > 0
            ? `Dedicated backend ready (${result.projectRef}). ${failedModules.length} module migration(s) failed — review the clone page.`
            : `Dedicated Supabase project created (${result.projectRef}) with admin ${data.adminEmail}`,
        clone_id: data.cloneId,
        url: `/clones/${data.cloneId}`,
        metadata: { project_ref: result.projectRef, module_migrations: moduleApplyResults },
      });

      return { ok: true as const };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Backend provisioning failed";

      await supabase
        .from("clone_backends")
        .update({
          status: "failed" as const,
          error_message: msg,
          status_detail: "Provisioning failed",
        })
        .eq("clone_id", data.cloneId);

      return { ok: false, error: msg };
    }
  });

/**
 * Get the backend status for a clone.
 */
export const getCloneBackendStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { cloneId: string }) => {
    if (!input?.cloneId?.trim()) throw new Error("cloneId is required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: backend } = await supabase
      .from("clone_backends")
      .select("*")
      .eq("clone_id", data.cloneId)
      .maybeSingle();

    return { backend };
  });

/**
 * Retry a failed backend provisioning.
 */
export const retryBackendProvisioning = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { cloneId: string; adminEmail: string; adminPassword: string }) => {
    if (!input?.cloneId?.trim()) throw new Error("cloneId is required");
    if (!input?.adminEmail?.trim()) throw new Error("adminEmail is required");
    if (!input?.adminPassword || input.adminPassword.length < 8) {
      throw new Error("adminPassword must be at least 8 characters");
    }
    return input;
  })
  .handler(async ({ data, context }): Promise<{ ok: true } | { ok: false; error: string }> => {
    const { supabase } = context;

    const { data: backend } = await supabase
      .from("clone_backends")
      .select("status")
      .eq("clone_id", data.cloneId)
      .maybeSingle();

    if (!backend || backend.status !== "failed") {
      return { ok: false, error: "Can only retry failed provisioning" };
    }

    // Reset to pending, then re-run
    await supabase
      .from("clone_backends")
      .update({ status: "pending" as const, error_message: null })
      .eq("clone_id", data.cloneId);

    // Get clone name
    const { data: clone } = await supabase
      .from("clones")
      .select("name")
      .eq("id", data.cloneId)
      .single();

    if (!clone) return { ok: false, error: "Clone not found" };

    const updateStatus = async (status: string, detail: string) => {
      await supabase
        .from("clone_backends")
        .update({
          status: status as "provisioning" | "migrating" | "seeding_admin",
          status_detail: detail,
        })
        .eq("clone_id", data.cloneId);
    };

    try {
      const result = await provisionCloneBackend(
        {
          cloneName: clone.name,
          adminEmail: data.adminEmail,
          adminPassword: data.adminPassword,
        },
        updateStatus,
      );

      await supabase
        .from("clone_backends")
        .update({
          supabase_project_ref: result.projectRef,
          supabase_url: result.projectUrl,
          anon_key: result.anonKey,
          service_role_key: encryptSecret(result.serviceRoleKey),
          db_pass: encryptSecret(result.dbPass),
          status: "ready" as const,
          status_detail: "Backend is ready",
          migration_version: "bootstrap_v1",
          error_message: null,
        })
        .eq("clone_id", data.cloneId);

      return { ok: true as const };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Retry failed";
      await supabase
        .from("clone_backends")
        .update({
          status: "failed" as const,
          error_message: msg,
          status_detail: "Retry failed",
        })
        .eq("clone_id", data.cloneId);
      return { ok: false, error: msg };
    }
  });