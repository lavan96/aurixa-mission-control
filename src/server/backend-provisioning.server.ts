/**
 * Supabase Management API helpers for programmatically provisioning
 * dedicated backend projects for each clone.
 *
 * Requires two secrets:
 *   SUPABASE_MGMT_API_TOKEN  – Personal Access Token from supabase.com/dashboard/account/tokens
 *   SUPABASE_ORG_ID          – Organization ID from supabase.com/dashboard/org/_/general
 */

const MGMT_API = "https://api.supabase.com/v1";

function getMgmtToken(): string {
  const token = process.env.SUPABASE_MGMT_API_TOKEN;
  if (!token) throw new Error("SUPABASE_MGMT_API_TOKEN secret is not configured");
  return token;
}

function getOrgId(): string {
  const orgId = process.env.SUPABASE_ORG_ID;
  if (!orgId) throw new Error("SUPABASE_ORG_ID secret is not configured");
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
export async function createSupabaseProject(
  input: CreateProjectInput
): Promise<SupabaseProject> {
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
  pollIntervalMs = 5_000
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
 * Retrieve the API keys (anon, service_role) for a project.
 */
export async function getProjectApiKeys(projectRef: string): Promise<ApiKey[]> {
  const res = await fetch(`${MGMT_API}/projects/${projectRef}/api-keys`, {
    headers: headers(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to get API keys: ${res.status} — ${body}`);
  }
  return res.json();
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
export async function runSqlOnProject(
  projectRef: string,
  sql: string
): Promise<unknown> {
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

// ─── Schema Replication ──────────────────────────────────────────────

/**
 * Get the canonical migration SQL from the prime's migration files.
 * In production, this would read from the supabase/migrations directory.
 * For now, we assemble the core schema needed by every clone.
 */
export function getCloneBootstrapSql(): string {
  // This is the essential schema every clone needs.
  // It mirrors the prime's schema but only includes the tables
  // a clone instance needs to operate independently.
  return `
-- Core enums
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'operator', 'user');
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

CREATE POLICY IF NOT EXISTS "Profiles viewable by authenticated"
  ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY IF NOT EXISTS "Users can insert own profile"
  ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "Users can update own profile"
  ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- User roles table
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer functions
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
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('admin', 'operator')
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

-- Bootstrap first admin trigger
CREATE OR REPLACE FUNCTION public.bootstrap_first_admin()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
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

-- Attach triggers (safe if they already exist)
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

-- User roles RLS
CREATE POLICY IF NOT EXISTS "Users can read own roles"
  ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "Admins can read all roles"
  ON public.user_roles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY IF NOT EXISTS "Admins can insert roles"
  ON public.user_roles FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY IF NOT EXISTS "Admins can update roles"
  ON public.user_roles FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY IF NOT EXISTS "Admins can delete roles"
  ON public.user_roles FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

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
  adminPassword: string
): Promise<{ userId: string }> {
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
    throw new Error(`Failed to create admin user: ${createRes.status} — ${body}`);
  }

  const user = await createRes.json();
  const userId = user.id;

  // Insert admin role via SQL
  await runSqlOnProject(
    projectRef,
    `INSERT INTO public.user_roles (user_id, role) VALUES ('${userId}', 'admin') ON CONFLICT DO NOTHING;`
  );

  return { userId };
}

// ─── Full Provisioning Pipeline ──────────────────────────────────────

export type ProvisionBackendInput = {
  cloneName: string;
  region?: string;
  adminEmail: string;
  adminPassword: string;
};

export type ProvisionBackendResult = {
  projectRef: string;
  projectUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  dbPass: string;
  adminUserId: string;
};

/**
 * Full pipeline: create project → wait ready → get keys → run migrations → seed admin.
 */
export async function provisionCloneBackend(
  input: ProvisionBackendInput,
  onStatusUpdate?: (status: string, detail: string) => Promise<void>
): Promise<ProvisionBackendResult> {
  const dbPass = generateSecurePassword();

  // Step 1: Create the project
  await onStatusUpdate?.("provisioning", "Creating Supabase project...");
  const project = await createSupabaseProject({
    name: `aurixa-clone-${input.cloneName}`,
    region: input.region,
    dbPass,
  });

  // Step 2: Wait for it to be ready
  await onStatusUpdate?.("provisioning", "Waiting for project to become healthy...");
  await waitForProjectReady(project.id);

  // Step 3: Get API keys
  await onStatusUpdate?.("provisioning", "Retrieving API keys...");
  const keys = await getProjectApiKeys(project.id);
  const anonKey = keys.find((k) => k.name === "anon")?.api_key;
  const serviceRoleKey = keys.find((k) => k.name === "service_role")?.api_key;

  if (!anonKey || !serviceRoleKey) {
    throw new Error("Could not retrieve anon or service_role key from new project");
  }

  const projectUrl = getProjectUrl(project.id);

  // Step 4: Run bootstrap migrations
  await onStatusUpdate?.("migrating", "Applying schema migrations...");
  const sql = getCloneBootstrapSql();
  await runSqlOnProject(project.id, sql);

  // Step 5: Seed admin
  await onStatusUpdate?.("seeding_admin", "Creating admin user...");
  const { userId: adminUserId } = await seedAdminUser(
    project.id,
    serviceRoleKey,
    projectUrl,
    input.adminEmail,
    input.adminPassword
  );

  return {
    projectRef: project.id,
    projectUrl,
    anonKey,
    serviceRoleKey,
    dbPass,
    adminUserId,
  };
}

function generateSecurePassword(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
  const length = 32;
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}
