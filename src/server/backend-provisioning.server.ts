/**
 * Supabase Management API helpers for programmatically provisioning
 * dedicated backend projects for each clone.
 *
 * Requires two secrets:
 *   SB_MGMT_API_TOKEN  – Personal Access Token from supabase.com/dashboard/account/tokens
 *   SB_ORG_ID          – Organization ID from supabase.com/dashboard/org/_/general
 */

import type { PrimeBackendSnapshot } from "./prime-backend.server";

const MGMT_API = "https://api.supabase.com/v1";

function getMgmtToken(): string {
  const token = process.env.SB_MGMT_API_TOKEN;
  if (!token) throw new Error("SB_MGMT_API_TOKEN secret is not configured");
  return token;
}

function getOrgId(): string {
  const orgId = process.env.SB_ORG_ID;
  if (!orgId) throw new Error("SB_ORG_ID secret is not configured");
  return orgId;
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${getMgmtToken()}`,
    "Content-Type": "application/json",
  };
}

// ─── Types ───────────────────────────────────────────────────────────

export type CreateProjectInput = {
  name: string;
  region?: string;
  plan?: "free" | "pro";
  dbPass: string;
};

export type SupabaseProject = {
  id: string; // project ref
  name: string;
  organization_id: string;
  region: string;
  status: string;
  created_at: string;
  database: {
    host: string;
    version: string;
  };
};

export type ApiKey = {
  name: string;
  api_key: string;
};

// ─── Project Lifecycle ───────────────────────────────────────────────

/**
 * Create a new Supabase project under the configured organization.
 */
export async function createSupabaseProject(input: CreateProjectInput): Promise<SupabaseProject> {
  const res = await fetch(`${MGMT_API}/projects`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      name: input.name,
      organization_id: getOrgId(),
      region: input.region || "us-east-1",
      plan: input.plan || "free",
      db_pass: input.dbPass,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to create Supabase project: ${res.status} — ${body}`);
  }

  return res.json();
}

/**
 * Poll project status until it becomes ACTIVE_HEALTHY or times out.
 */
export async function waitForProjectReady(
  projectRef: string,
  maxWaitMs = 120_000,
  pollIntervalMs = 5_000,
): Promise<SupabaseProject> {
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    const res = await fetch(`${MGMT_API}/projects/${projectRef}`, {
      headers: headers(),
    });
    if (!res.ok) {
      throw new Error(`Failed to check project status: ${res.status}`);
    }
    const project: SupabaseProject = await res.json();
    if (project.status === "ACTIVE_HEALTHY") {
      return project;
    }
    // Wait before polling again
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  throw new Error(`Project ${projectRef} did not become ready within ${maxWaitMs / 1000}s`);
}

/**
 * Retrieve the API keys for a project. `reveal=true` is required for the
 * Management API to include raw key values in the response.
 */
export async function getProjectApiKeys(projectRef: string): Promise<ApiKey[]> {
  const res = await fetch(`${MGMT_API}/projects/${projectRef}/api-keys?reveal=true`, {
    headers: headers(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to get API keys: ${res.status} — ${body}`);
  }
  return res.json();
}

/**
 * Pick the client-safe and privileged keys from a project's key list,
 * handling both legacy (anon / service_role) and current
 * (publishable / secret) Supabase key naming.
 */
export function selectProjectKeys(keys: ApiKey[]): {
  anonKey: string | null;
  serviceRoleKey: string | null;
} {
  const byName = (n: string) => keys.find((k) => k.name === n)?.api_key ?? null;
  const byType = (t: string) =>
    keys.find((k) => (k as { type?: string }).type === t)?.api_key ?? null;
  const byPrefix = (p: string) => keys.find((k) => k.api_key?.startsWith(p))?.api_key ?? null;
  return {
    anonKey: byName("anon") ?? byType("publishable") ?? byPrefix("sb_publishable_"),
    serviceRoleKey: byName("service_role") ?? byType("secret") ?? byPrefix("sb_secret_"),
  };
}

/**
 * Get the project URL from the ref.
 */
export function getProjectUrl(projectRef: string): string {
  return `https://${projectRef}.supabase.co`;
}

// ─── Database Queries ────────────────────────────────────────────────

/**
 * Run a SQL query against a project's database via the Management API.
 */
export async function runSqlOnProject(projectRef: string, sql: string): Promise<unknown> {
  const res = await fetch(`${MGMT_API}/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ query: sql }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SQL execution failed on ${projectRef}: ${res.status} — ${body}`);
  }

  return res.json();
}

// ─── Prime Architecture Replication ──────────────────────────────────

/**
 * Every clone backend carries its own migration ledger so replays are
 * idempotent and resumable. Lives in a dedicated `aurixa` schema to keep
 * the replicated `public` schema byte-identical to the prime's.
 */
const TRACKING_TABLE_SQL = `
create schema if not exists aurixa;
create table if not exists aurixa.schema_migrations (
  version text primary key,
  name text not null,
  applied_at timestamptz not null default now()
);
`.trim();

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export type PrimeMigrationResult = {
  id: string;
  name: string;
  success: boolean;
  skipped?: boolean;
  error?: string;
};

/**
 * Replay the prime's migrations onto a clone project, in order, skipping
 * any version already recorded in the clone's ledger. Stops on the first
 * failure so later migrations never run against a half-applied schema.
 */
export async function applyPrimeMigrations(
  projectRef: string,
  migrations: Array<{ id: string; name: string; sql: string }>,
  onStatusUpdate?: (status: string, detail: string) => Promise<void>,
): Promise<{ results: PrimeMigrationResult[]; latestApplied: string | null }> {
  await runSqlOnProject(projectRef, TRACKING_TABLE_SQL);

  const appliedRaw = await runSqlOnProject(
    projectRef,
    "select version from aurixa.schema_migrations;",
  );
  // The query endpoint returns rows as a bare array; tolerate wrapped shapes too.
  const appliedRows = Array.isArray(appliedRaw)
    ? appliedRaw
    : Array.isArray((appliedRaw as { rows?: unknown[] })?.rows)
      ? (appliedRaw as { rows: unknown[] }).rows
      : Array.isArray((appliedRaw as { result?: unknown[] })?.result)
        ? (appliedRaw as { result: unknown[] }).result
        : [];
  const applied = new Set(
    appliedRows
      .map((r) => (r as { version?: unknown })?.version)
      .filter((v): v is string => typeof v === "string"),
  );

  const results: PrimeMigrationResult[] = [];
  let latestApplied: string | null = null;

  const ordered = [...migrations].sort((a, b) => a.name.localeCompare(b.name));
  for (let i = 0; i < ordered.length; i++) {
    const m = ordered[i];
    if (applied.has(m.id)) {
      results.push({ id: m.id, name: m.name, success: true, skipped: true });
      latestApplied = m.id;
      continue;
    }
    await onStatusUpdate?.("migrating", `Applying migration ${i + 1}/${ordered.length}: ${m.name}`);
    try {
      await runSqlOnProject(projectRef, m.sql);
      await runSqlOnProject(
        projectRef,
        `insert into aurixa.schema_migrations (version, name) values (${sqlLiteral(m.id)}, ${sqlLiteral(m.name)}) on conflict (version) do nothing;`,
      );
      results.push({ id: m.id, name: m.name, success: true });
      latestApplied = m.id;
    } catch (e) {
      results.push({
        id: m.id,
        name: m.name,
        success: false,
        error: e instanceof Error ? e.message : "SQL failed",
      });
      break; // halt replay — schema state beyond this point is undefined
    }
  }

  return { results, latestApplied };
}

export type EdgeFunctionDeployResult = {
  slug: string;
  success: boolean;
  error?: string;
};

/**
 * Deploy one edge function bundle to a clone project via the Management API.
 * File paths are relative to the prime's supabase/functions/ directory, so
 * `../_shared/x.ts`-style imports inside a function resolve within the bundle.
 */
export async function deployEdgeFunction(
  projectRef: string,
  fn: {
    slug: string;
    entrypointPath: string;
    importMapPath: string | null;
    verifyJwt: boolean;
    files: Array<{ path: string; contentBase64: string }>;
  },
): Promise<void> {
  const form = new FormData();
  form.append(
    "metadata",
    JSON.stringify({
      name: fn.slug,
      entrypoint_path: fn.entrypointPath,
      ...(fn.importMapPath ? { import_map_path: fn.importMapPath } : {}),
      verify_jwt: fn.verifyJwt,
    }),
  );
  for (const file of fn.files) {
    const bytes = Buffer.from(file.contentBase64, "base64");
    form.append("file", new Blob([new Uint8Array(bytes)]), file.path);
  }

  const res = await fetch(
    `${MGMT_API}/projects/${projectRef}/functions/deploy?slug=${encodeURIComponent(fn.slug)}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${getMgmtToken()}` }, // FormData sets its own Content-Type
      body: form,
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Deploy failed for ${fn.slug}: ${res.status} — ${body}`);
  }
}

export async function deployEdgeFunctions(
  projectRef: string,
  functions: Array<Parameters<typeof deployEdgeFunction>[1]>,
  onStatusUpdate?: (status: string, detail: string) => Promise<void>,
): Promise<EdgeFunctionDeployResult[]> {
  const results: EdgeFunctionDeployResult[] = [];
  for (let i = 0; i < functions.length; i++) {
    const fn = functions[i];
    await onStatusUpdate?.(
      "migrating",
      `Deploying edge function ${i + 1}/${functions.length}: ${fn.slug}`,
    );
    try {
      await deployEdgeFunction(projectRef, fn);
      results.push({ slug: fn.slug, success: true });
    } catch (e) {
      // Non-fatal: record and continue so one broken function doesn't block the rest
      results.push({
        slug: fn.slug,
        success: false,
        error: e instanceof Error ? e.message : "deploy failed",
      });
    }
  }
  return results;
}

export type SecretShellResult = {
  name: string;
  success: boolean;
  error?: string;
};

/** Placeholder written when the API refuses truly empty secret values. */
const SECRET_SHELL_PLACEHOLDER = "__EMPTY_SHELL__";

/**
 * Create empty-shell secrets on a clone project: the names the prime's edge
 * functions expect, with no real values. Operators fill them in later.
 */
export async function createSecretShells(
  projectRef: string,
  names: string[],
): Promise<SecretShellResult[]> {
  if (names.length === 0) return [];

  const post = async (value: string) =>
    fetch(`${MGMT_API}/projects/${projectRef}/secrets`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(names.map((name) => ({ name, value }))),
    });

  let res = await post("");
  if (!res.ok && res.status >= 400 && res.status < 500) {
    // Some API versions reject empty values — fall back to an explicit placeholder
    res = await post(SECRET_SHELL_PLACEHOLDER);
  }
  if (!res.ok) {
    const body = await res.text();
    return names.map((name) => ({
      name,
      success: false,
      error: `secrets API ${res.status} — ${body.slice(0, 300)}`,
    }));
  }
  return names.map((name) => ({ name, success: true }));
}

// ─── Legacy bootstrap schema (reference only) ────────────────────────

/**
 * Legacy hand-rolled base schema, kept for the Settings preview page.
 * Provisioning no longer uses this — clone schemas come from the prime
 * repo's own migration files (see applyPrimeMigrations).
 */
export function getCloneBootstrapSql(): string {
  // This is the essential schema every clone needs.
  // It mirrors the prime's schema but only includes the tables
  // a clone instance needs to operate independently.
  return `
-- Core enums
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('super_admin', 'admin', 'operator', 'user');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE,
  display_name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Profiles viewable by authenticated"
    ON public.profiles FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Users can insert own profile"
    ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Users can update own profile"
    ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- User roles table
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  assigned_by uuid,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- ── Hierarchy helper functions ──

CREATE OR REPLACE FUNCTION public.role_level(_role public.app_role)
RETURNS integer
LANGUAGE plpgsql IMMUTABLE SET search_path = public
AS $fn$
BEGIN
  RETURN CASE _role::text
    WHEN 'super_admin' THEN 100
    WHEN 'admin'       THEN 80
    WHEN 'operator'    THEN 50
    WHEN 'user'        THEN 10
    ELSE 0
  END;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.highest_role_level(_user_id uuid)
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE _level integer;
BEGIN
  SELECT COALESCE(MAX(public.role_level(role)), 0) INTO _level
  FROM public.user_roles WHERE user_id = _user_id;
  RETURN _level;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.can_assign_role(_assigner_id uuid, _target_role public.app_role)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  RETURN public.highest_role_level(_assigner_id) > public.role_level(_target_role);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.can_manage_user(_manager_id uuid, _target_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  RETURN public.highest_role_level(_manager_id) > public.highest_role_level(_target_user_id);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$fn$;

CREATE OR REPLACE FUNCTION public.is_operator(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('super_admin', 'admin', 'operator')
  )
$fn$;

-- Handle new user trigger
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));
  RETURN NEW;
END;
$fn$;

-- Bootstrap first admin trigger (grants super_admin to first user)
CREATE OR REPLACE FUNCTION public.bootstrap_first_admin()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'super_admin') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'super_admin');
  END IF;
  RETURN NEW;
END;
$fn$;

-- Updated at helper
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $fn$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$fn$;

-- ── Guardrail triggers ──

CREATE OR REPLACE FUNCTION public.guard_last_super_admin()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF OLD.role = 'super_admin' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.user_roles WHERE role = 'super_admin' AND id <> OLD.id
    ) THEN
      RAISE EXCEPTION 'Cannot remove the last super_admin from the system';
    END IF;
  END IF;
  RETURN OLD;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.enforce_role_hierarchy()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF NEW.assigned_by IS NULL THEN RETURN NEW; END IF;
  IF NOT public.can_assign_role(NEW.assigned_by, NEW.role) THEN
    RAISE EXCEPTION 'Insufficient privileges: cannot assign role %', NEW.role;
  END IF;
  RETURN NEW;
END;
$fn$;

-- Attach triggers
DO $$ BEGIN
  CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER on_first_signup_bootstrap_admin
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.bootstrap_first_admin();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER guard_last_super_admin_delete
    BEFORE DELETE ON public.user_roles
    FOR EACH ROW EXECUTE FUNCTION public.guard_last_super_admin();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER guard_last_super_admin_update
    BEFORE UPDATE ON public.user_roles
    FOR EACH ROW
    WHEN (OLD.role = 'super_admin' AND NEW.role <> 'super_admin')
    EXECUTE FUNCTION public.guard_last_super_admin();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER enforce_role_hierarchy_insert
    BEFORE INSERT ON public.user_roles
    FOR EACH ROW EXECUTE FUNCTION public.enforce_role_hierarchy();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER enforce_role_hierarchy_update
    BEFORE UPDATE ON public.user_roles
    FOR EACH ROW EXECUTE FUNCTION public.enforce_role_hierarchy();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- User roles RLS (hierarchy-aware)
DO $$ BEGIN
  CREATE POLICY "Users can read own roles"
    ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Admins and super_admins can read all roles"
    ON public.user_roles FOR SELECT TO authenticated
    USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Hierarchy-enforced role assignment"
    ON public.user_roles FOR INSERT TO authenticated
    WITH CHECK (public.can_assign_role(auth.uid(), role) AND assigned_by = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Hierarchy-enforced role update"
    ON public.user_roles FOR UPDATE TO authenticated
    USING (public.can_manage_user(auth.uid(), user_id));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Hierarchy-enforced role deletion"
    ON public.user_roles FOR DELETE TO authenticated
    USING (public.can_manage_user(auth.uid(), user_id));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Timestamp triggers
DO $$ BEGIN
  CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
  `.trim();
}

/**
 * Seed an admin user into the clone's backend using the Management API.
 * Creates the user via the Auth Admin API and inserts their admin role.
 */
export async function seedAdminUser(
  projectRef: string,
  serviceRoleKey: string,
  projectUrl: string,
  adminEmail: string,
  adminPassword: string,
): Promise<{ userId: string | null }> {
  // Create user via Supabase Auth Admin API (using service role key)
  const createRes = await fetch(`${projectUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      user_metadata: { display_name: "Admin" },
    }),
  });

  if (!createRes.ok) {
    const body = await createRes.text();
    // Resume path: the admin may already exist from a previous attempt
    if (createRes.status === 422 || /already.*(registered|exists)/i.test(body)) {
      return { userId: null };
    }
    throw new Error(`Failed to create admin user: ${createRes.status} — ${body}`);
  }

  const user = await createRes.json();
  const userId = user.id;

  // Best-effort super_admin grant: the clone's schema is whatever the prime
  // repo defines, so only insert if a user_roles table actually exists, and
  // never let a role-model mismatch fail the whole provisioning run.
  await runSqlOnProject(
    projectRef,
    `
DO $$ BEGIN
  IF to_regclass('public.user_roles') IS NOT NULL THEN
    EXECUTE format(
      'INSERT INTO public.user_roles (user_id, role) VALUES (%L, %L) ON CONFLICT DO NOTHING',
      '${userId}'::uuid, 'super_admin'
    );
  END IF;
EXCEPTION WHEN others THEN
  RAISE WARNING 'aurixa: admin role seed skipped: %', SQLERRM;
END $$;
    `.trim(),
  );

  return { userId };
}

// ─── Full Provisioning Pipeline ──────────────────────────────────────

export type ProvisionBackendInput = {
  cloneName: string;
  region?: string;
  adminEmail: string;
  adminPassword: string;
  /** The prime repo's Supabase architecture to replicate onto the new project. */
  snapshot: PrimeBackendSnapshot;
  /**
   * Resume onto a project created by an earlier failed run instead of
   * creating (and paying for) a fresh one. The migration ledger makes the
   * replay pick up exactly where it stopped.
   */
  existingProjectRef?: string | null;
};

export type ProvisionBackendResult = {
  projectRef: string;
  projectUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  /** null when resuming an existing project — the original password is kept */
  dbPass: string | null;
  adminUserId: string | null;
  migrationsApplied: PrimeMigrationResult[];
  latestMigration: string | null;
  edgeFunctions: EdgeFunctionDeployResult[];
  secretShells: SecretShellResult[];
};

/**
 * Full pipeline: create project → wait ready → get keys → replay the prime's
 * migrations → deploy the prime's edge functions → create empty-shell secrets
 * → seed admin. Structure only — no data ever leaves the prime.
 */
export async function provisionCloneBackend(
  input: ProvisionBackendInput,
  onStatusUpdate?: (status: string, detail: string) => Promise<void>,
): Promise<ProvisionBackendResult> {
  const { snapshot } = input;

  // Step 1: Create the project (or resume onto a surviving one)
  let projectRef = input.existingProjectRef ?? null;
  let dbPass: string | null = null;
  if (projectRef) {
    await onStatusUpdate?.("provisioning", `Resuming on existing project ${projectRef}...`);
  } else {
    dbPass = generateSecurePassword();
    await onStatusUpdate?.("provisioning", "Creating Supabase project...");
    const project = await createSupabaseProject({
      name: `aurixa-clone-${input.cloneName}`,
      region: input.region,
      dbPass,
    });
    projectRef = project.id;
  }

  // Step 2: Wait for it to be ready
  await onStatusUpdate?.("provisioning", "Waiting for project to become healthy...");
  await waitForProjectReady(projectRef);

  // Step 3: Get API keys
  await onStatusUpdate?.("provisioning", "Retrieving API keys...");
  const { anonKey, serviceRoleKey } = selectProjectKeys(await getProjectApiKeys(projectRef));
  if (!anonKey || !serviceRoleKey) {
    throw new Error("Could not retrieve client/privileged API keys from new project");
  }

  const projectUrl = getProjectUrl(projectRef);

  // Step 4: Replay the prime repo's migrations (schema, tables, RLS, functions)
  await onStatusUpdate?.(
    "migrating",
    `Replicating ${snapshot.migrations.length} migration(s) from ${snapshot.sourceRepo}@${snapshot.sourceSha.slice(0, 7)}...`,
  );
  const { results: migrationsApplied, latestApplied } = await applyPrimeMigrations(
    projectRef,
    snapshot.migrations,
    onStatusUpdate,
  );
  const migrationFailure = migrationsApplied.find((r) => !r.success);
  if (migrationFailure) {
    throw new Error(
      `Migration ${migrationFailure.name} failed: ${migrationFailure.error ?? "unknown"} ` +
        `(project ${projectRef} kept — retry resumes from the failed migration)`,
    );
  }

  // Step 5: Deploy the prime's edge functions (non-fatal per function)
  const edgeFunctions = await deployEdgeFunctions(projectRef, snapshot.functions, onStatusUpdate);

  // Step 6: Create empty-shell secrets for every name the functions reference
  await onStatusUpdate?.(
    "migrating",
    `Creating ${snapshot.secretNames.length} empty secret shell(s)...`,
  );
  const secretShells = await createSecretShells(projectRef, snapshot.secretNames);

  // Step 7: Seed admin
  await onStatusUpdate?.("seeding_admin", "Creating admin user...");
  const { userId: adminUserId } = await seedAdminUser(
    projectRef,
    serviceRoleKey,
    projectUrl,
    input.adminEmail,
    input.adminPassword,
  );

  return {
    projectRef,
    projectUrl,
    anonKey,
    serviceRoleKey,
    dbPass,
    adminUserId,
    migrationsApplied,
    latestMigration: latestApplied,
    edgeFunctions,
    secretShells,
  };
}

function generateSecurePassword(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
  const length = 32;
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}
