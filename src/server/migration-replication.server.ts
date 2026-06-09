/**
 * Migration replication engine for clone backends.
 *
 * Manages a registry of migrations, categorises them as clone-applicable
 * or prime-only, and replays applicable migrations against clone backends
 * via the Supabase Management API.
 */

import { runSqlOnProject } from "./backend-provisioning.server";

// ─── Migration Registry ──────────────────────────────────────────────

export type MigrationEntry = {
  /** Filename-derived ID, e.g. "20260419215311" */
  id: string;
  /** Full filename */
  filename: string;
  /** Human-readable description */
  description: string;
  /** Whether this migration should be applied to clone backends */
  cloneApplicable: boolean;
  /** The SQL to execute (loaded lazily from the migration file) */
  sql: string;
};

/**
 * The canonical migration registry.
 *
 * Each prime migration is listed here with:
 * - cloneApplicable: true  → will be replayed on clone backends
 * - cloneApplicable: false → prime-only (dashboard infra, clone management tables, etc.)
 *
 * When a new migration is added to the prime, it should be registered here
 * with the correct applicability flag.
 *
 * NOTE: The SQL is loaded at runtime from the migration files to avoid
 * bloating this module. We use a lazy-load approach for the actual SQL.
 */
const MIGRATION_REGISTRY: Omit<MigrationEntry, "sql">[] = [
  {
    id: "20260419215311",
    filename: "20260419215311_091021d2-99de-4fc1-b893-0cfa0ddf8f6c.sql",
    description:
      "Base schema: enums, profiles, user_roles, prime_config, clones, modules, cascade tables, audit_log",
    cloneApplicable: false, // Contains prime_config, clones — prime-only infrastructure
  },
  {
    id: "20260419224307",
    filename: "20260419224307_42dc6748-6386-4986-8fc4-be3695930dd4.sql",
    description: "Add drift_suggestions and last_drift_check_at to clones",
    cloneApplicable: false, // clones table is prime-only
  },
  {
    id: "20260419224621",
    filename: "20260419224621_a1fcb05d-2e1d-4718-8f34-f3eab778a862.sql",
    description: "Enable pg_cron and pg_net extensions",
    cloneApplicable: false, // Infra extensions for prime scheduling
  },
  {
    id: "20260419224948",
    filename: "20260419224948_a3b93dbd-6698-4664-b85a-7516f455f9a4.sql",
    description: "Enable realtime for cascade_results",
    cloneApplicable: false, // cascade_results is prime-only
  },
  {
    id: "20260419225856",
    filename: "20260419225856_afcd1a6f-355b-452e-851b-61f3894a23b6.sql",
    description: "Enable realtime for cascade_events and clones",
    cloneApplicable: false,
  },
  {
    id: "20260419230402",
    filename: "20260419230402_ef98a62b-0c55-47d0-bcff-38e5813758bb.sql",
    description: "Notification system: kind enum, notifications table, RLS",
    cloneApplicable: true, // Clones need their own notification system
  },
  {
    id: "20260419232720",
    filename: "20260419232720_109e3c54-3a74-439a-87ee-8384cbff3bd5.sql",
    description: "Push subscriptions table",
    cloneApplicable: true, // Clones may use push notifications
  },
  {
    id: "20260419235051",
    filename: "20260419235051_277a243e-70ad-4a35-ab31-b7b71539a83f.sql",
    description: "Notification preferences per user",
    cloneApplicable: true,
  },
  {
    id: "20260420023720",
    filename: "20260420023720_0f38ad07-b74e-4dca-8f94-a7a68ef370ee.sql",
    description: "Add default_cascade_mode to prime_config",
    cloneApplicable: false,
  },
  {
    id: "20260420024718",
    filename: "20260420024718_4d1d4507-139e-4078-b2a8-2caa10f905fd.sql",
    description: "Add default_cascade_mode (duplicate safe), pg_cron/pg_net",
    cloneApplicable: false,
  },
  {
    id: "20260420025437",
    filename: "20260420025437_11680817-f628-4ff4-ae5b-8c2c8403e4de.sql",
    description: "Enable realtime for audit_log",
    cloneApplicable: false,
  },
  {
    id: "20260420041121",
    filename: "20260420041121_972dd850-1d6c-40cd-a91f-a97b84e7f849.sql",
    description: "Cascade schedules, drift policies, module configs",
    cloneApplicable: false, // These are prime fleet management tables
  },
  {
    id: "20260420043600",
    filename: "20260420043600_247201d4-1924-4363-9e36-985c4087c319.sql",
    description: "Cascade templates table",
    cloneApplicable: false,
  },
  {
    id: "20260420044150",
    filename: "20260420044150_4c4d591f-e173-4b63-8962-eacd42ab1f67.sql",
    description: "Approval tracking columns on cascade_events",
    cloneApplicable: false,
  },
  {
    id: "20260420044815",
    filename: "20260420044815_e64d5931-31f9-4b25-83f0-6477137ac1d2.sql",
    description: "Add cascade_awaiting_approval notification kind",
    cloneApplicable: true, // Notification enum extension
  },
  {
    id: "20260420045539",
    filename: "20260420045539_6e7a9d03-7ad6-4e76-b769-b08564fefef9.sql",
    description: "Clone health snapshots table",
    cloneApplicable: false,
  },
  {
    id: "20260420060847",
    filename: "20260420060847_ed5634e5-989c-47b8-b15d-fbe18e489f61.sql",
    description: "Add cascade_approved/rejected notification kinds",
    cloneApplicable: true,
  },
  {
    id: "20260422214254",
    filename: "20260422214254_cab7f983-6f63-4d2a-80b0-a2a065d206c0.sql",
    description: "Module config snapshots table",
    cloneApplicable: false,
  },
  {
    id: "20260422215007",
    filename: "20260422215007_97bf0084-081a-47bb-82f0-a4e8b232a0ab.sql",
    description: "Add previous_sha to cascade_results",
    cloneApplicable: false,
  },
  {
    id: "20260422234212",
    filename: "20260422234212_bc61d541-54c8-49b5-bcd6-b6c8be569316.sql",
    description: "Fix malformed github_repo value in prime_config",
    cloneApplicable: false, // Data fix on prime_config
  },
  {
    id: "20260422235720",
    filename: "20260422235720_3fe15343-81a9-45a4-8e82-80c547a38d7b.sql",
    description: "Clone backends table and status enum",
    cloneApplicable: false, // Prime-only infrastructure
  },
  {
    id: "20260423014944",
    filename: "20260423014944_819f43b9-9083-40e2-a72b-4e2cc49d02fa.sql",
    description: "Push notifications trigger via pg_net",
    cloneApplicable: true,
  },
  {
    id: "20260423051802",
    filename: "20260423051802_48003d58-33a4-438c-89d0-11aca0fbdfe2.sql",
    description: "Add super_admin enum value and assigned_by/assigned_at columns to user_roles",
    cloneApplicable: false, // Clone bootstrap SQL already includes the full schema
  },
  {
    id: "20260423051923",
    filename: "20260423051923_e4dc3ff5-dcc7-4c0a-984f-2bcc1662fe61.sql",
    description: "Admin hierarchy: role_level, guardrail triggers, hierarchy-aware RLS policies",
    cloneApplicable: false, // Clone bootstrap SQL already includes the full schema
  },
  {
    id: "20260423052527",
    filename: "20260423052527_d6d2a61a-6c72-4c6a-9ac6-e70207114e2a.sql",
    description: "Add user value to app_role enum",
    cloneApplicable: false, // Clone bootstrap SQL already includes user in enum
  },
];

// ─── Migration Loader ────────────────────────────────────────────────

/**
 * Load migration SQL from the filesystem.
 * In the Worker runtime, we embed migrations at build time.
 */
async function loadMigrationSql(filename: string): Promise<string> {
  // In the server runtime, read from the filesystem
  const fs = await import("fs");
  const path = await import("path");
  const migrationPath = path.join(process.cwd(), "supabase", "migrations", filename);
  return fs.readFileSync(migrationPath, "utf-8");
}

/**
 * Get all clone-applicable migrations sorted by ID (chronological).
 */
export function getCloneApplicableMigrations(): Omit<MigrationEntry, "sql">[] {
  return MIGRATION_REGISTRY.filter((m) => m.cloneApplicable).sort((a, b) =>
    a.id.localeCompare(b.id),
  );
}

/**
 * Get all migrations (both applicable and not) for display purposes.
 */
export function getAllMigrations(): Omit<MigrationEntry, "sql">[] {
  return [...MIGRATION_REGISTRY].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Get the latest migration ID for version tracking.
 */
export function getLatestMigrationId(): string {
  const sorted = [...MIGRATION_REGISTRY].sort((a, b) => b.id.localeCompare(a.id));
  return sorted[0]?.id ?? "none";
}

/**
 * Get the latest clone-applicable migration ID.
 */
export function getLatestCloneMigrationId(): string {
  const applicable = getCloneApplicableMigrations();
  return applicable[applicable.length - 1]?.id ?? "none";
}

// ─── Migration Application ──────────────────────────────────────────

export type MigrationResult = {
  migrationId: string;
  success: boolean;
  error?: string;
};

/**
 * Apply a single migration to a clone backend.
 */
export async function applyMigration(
  projectRef: string,
  migration: Omit<MigrationEntry, "sql">,
): Promise<MigrationResult> {
  try {
    const sql = await loadMigrationSql(migration.filename);
    await runSqlOnProject(projectRef, sql);
    return { migrationId: migration.id, success: true };
  } catch (e) {
    return {
      migrationId: migration.id,
      success: false,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
}

/**
 * Apply all pending clone-applicable migrations to a clone backend.
 * Returns results for each migration applied.
 */
export async function applyPendingMigrations(
  projectRef: string,
  lastAppliedId: string | null,
): Promise<{
  results: MigrationResult[];
  newVersion: string;
}> {
  const applicable = getCloneApplicableMigrations();

  // Filter to only migrations newer than lastAppliedId
  const pending = lastAppliedId ? applicable.filter((m) => m.id > lastAppliedId) : applicable;

  if (pending.length === 0) {
    return {
      results: [],
      newVersion: lastAppliedId || "bootstrap_v1",
    };
  }

  const results: MigrationResult[] = [];
  let lastSuccessful = lastAppliedId || "bootstrap_v1";

  for (const migration of pending) {
    const result = await applyMigration(projectRef, migration);
    results.push(result);

    if (!result.success) {
      // Stop on first failure — don't apply subsequent migrations
      break;
    }
    lastSuccessful = migration.id;
  }

  return { results, newVersion: lastSuccessful };
}

/**
 * Get a summary of pending migrations for a clone.
 */
export function getPendingMigrationCount(lastAppliedId: string | null): number {
  const applicable = getCloneApplicableMigrations();
  if (!lastAppliedId) return applicable.length;
  return applicable.filter((m) => m.id > lastAppliedId).length;
}

/**
 * Get detailed pending migration info for a clone.
 */
export function getPendingMigrations(lastAppliedId: string | null): Omit<MigrationEntry, "sql">[] {
  const applicable = getCloneApplicableMigrations();
  if (!lastAppliedId) return applicable;
  return applicable.filter((m) => m.id > lastAppliedId);
}
