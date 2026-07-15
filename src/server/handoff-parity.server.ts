// @ts-nocheck
/**
 * Handoff parity engine (G1 + G3).
 *
 * Computes a structural diff between the prime Aurixa backend and a target
 * clone / client-owned Supabase project so an admin can review exactly what
 * will move during a handoff before any physical action runs.
 *
 * Surfaces compared:
 *   G1 — Tables & columns in `public`
 *      — RLS enabled flag per table
 *      — RLS policy names per table
 *      — Database functions in `public`
 *      — Installed extensions
 *   G3 — Storage buckets (visibility + size cap + mime allowlist)
 *      — pg_cron jobs (name + schedule + active)
 *      — Edge function slugs
 *      — Secret key names (names only — values never read)
 *      — Auth config (whitelisted subset: site_url, uri_allow_list,
 *                     jwt_exp, disable_signup, minimum password length,
 *                     mailer_autoconfirm)
 */

import {
  runSqlOnProject,
  listProjectStorageBuckets,
  fetchPrimeCronJobs,
  listProjectEdgeFunctionSlugs,
  listProjectSecretNames,
  getProjectAuthConfig,
  fetchRealtimePublicationTables,
  REQUIRED_EXTENSIONS,
  type StorageBucketConfig,
  type PrimeCronJob,
  type RealtimePublicationTable,
} from "./backend-provisioning.server";


type Row = Record<string, unknown>;

function rows(raw: unknown): Row[] {
  if (Array.isArray(raw)) return raw as Row[];
  if (raw && typeof raw === "object" && Array.isArray((raw as any).result)) {
    return (raw as any).result as Row[];
  }
  return [];
}

export function getPrimeProjectRef(): string {
  const url = process.env.SUPABASE_URL;
  if (!url) throw new Error("SUPABASE_URL not configured on server");
  const m = url.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i);
  if (!m) throw new Error(`Cannot derive project ref from SUPABASE_URL=${url}`);
  return m[1];
}

// ── Introspection SQL ─────────────────────────────────────────────────

const TABLES_SQL = `
  select table_schema, table_name, column_name, data_type, is_nullable
    from information_schema.columns
   where table_schema = 'public'
   order by table_name, ordinal_position
`;

const RLS_SQL = `
  select c.relname as table_name, c.relrowsecurity as rls_enabled
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
`;

const POLICIES_SQL = `
  select schemaname, tablename, policyname, cmd, roles::text as roles
    from pg_policies
   where schemaname = 'public'
   order by tablename, policyname
`;

const FUNCTIONS_SQL = `
  select n.nspname as schema, p.proname as name,
         pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind = 'f'
   order by name, args
`;

const EXTENSIONS_SQL = `
  select extname as name, extversion as version
    from pg_extension
   order by name
`;

// ── Fetch snapshots ───────────────────────────────────────────────────

async function snapshotProject(ref: string) {
  const [t, r, p, f, e, buckets, cron, edgeFns, secretNames, authCfg, realtimeTables] = await Promise.all([
    runSqlOnProject(ref, TABLES_SQL).then(rows),
    runSqlOnProject(ref, RLS_SQL).then(rows),
    runSqlOnProject(ref, POLICIES_SQL).then(rows),
    runSqlOnProject(ref, FUNCTIONS_SQL).then(rows),
    runSqlOnProject(ref, EXTENSIONS_SQL).then(rows),
    listProjectStorageBuckets(ref).catch(() => [] as StorageBucketConfig[]),
    fetchPrimeCronJobs(ref).catch(() => [] as PrimeCronJob[]),
    listProjectEdgeFunctionSlugs(ref),
    listProjectSecretNames(ref),
    getProjectAuthConfig(ref),
    fetchRealtimePublicationTables(ref).catch(() => [] as RealtimePublicationTable[]),
  ]);


  const columnsByTable = new Map<string, Map<string, Row>>();
  for (const row of t) {
    const tbl = String(row.table_name);
    if (!columnsByTable.has(tbl)) columnsByTable.set(tbl, new Map());
    columnsByTable.get(tbl)!.set(String(row.column_name), row);
  }

  const rlsByTable = new Map<string, boolean>();
  for (const row of r) rlsByTable.set(String(row.table_name), Boolean(row.rls_enabled));

  const policiesByTable = new Map<string, Row[]>();
  for (const row of p) {
    const tbl = String(row.tablename);
    if (!policiesByTable.has(tbl)) policiesByTable.set(tbl, []);
    policiesByTable.get(tbl)!.push(row);
  }

  const functionSigs = new Set<string>();
  for (const row of f) functionSigs.add(`${row.name}(${row.args})`);

  const extensions = new Map<string, string>();
  for (const row of e) extensions.set(String(row.name), String(row.version ?? ""));

  const bucketsById = new Map<string, StorageBucketConfig>();
  for (const b of buckets) bucketsById.set(b.id, b);

  const cronByName = new Map<string, PrimeCronJob>();
  for (const j of cron) cronByName.set(j.jobname, j);

  const edgeFnSet = new Set<string>(edgeFns);
  const secretSet = new Set<string>(secretNames);

  const realtimeSet = new Set<string>(
    (realtimeTables ?? []).map((t) => `${t.schema}.${t.table}`),
  );

  return {
    columnsByTable,
    rlsByTable,
    policiesByTable,
    functionSigs,
    extensions,
    bucketsById,
    cronByName,
    edgeFnSet,
    secretSet,
    realtimeSet,
    authCfg: authCfg ?? {},
  };
}


type Snapshot = Awaited<ReturnType<typeof snapshotProject>>;

// ── Diff computation ──────────────────────────────────────────────────

function diffTables(prime: Snapshot, target: Snapshot) {
  const primeTables = new Set(prime.columnsByTable.keys());
  const targetTables = new Set(target.columnsByTable.keys());

  const missingInTarget: string[] = [];
  const extraInTarget: string[] = [];
  const columnDrift: Array<{
    table: string;
    missing: string[];
    extra: string[];
    typeChanges: Array<{ column: string; prime: string; target: string }>;
  }> = [];

  for (const t of primeTables) {
    if (!targetTables.has(t)) {
      missingInTarget.push(t);
      continue;
    }
    const primeCols = prime.columnsByTable.get(t)!;
    const targetCols = target.columnsByTable.get(t)!;
    const missing: string[] = [];
    const extra: string[] = [];
    const typeChanges: Array<{ column: string; prime: string; target: string }> = [];
    for (const [name, def] of primeCols) {
      if (!targetCols.has(name)) missing.push(name);
      else {
        const td = targetCols.get(name)!;
        if (String(def.data_type) !== String(td.data_type)) {
          typeChanges.push({ column: name, prime: String(def.data_type), target: String(td.data_type) });
        }
      }
    }
    for (const name of targetCols.keys()) if (!primeCols.has(name)) extra.push(name);
    if (missing.length || extra.length || typeChanges.length) {
      columnDrift.push({ table: t, missing, extra, typeChanges });
    }
  }
  for (const t of targetTables) if (!primeTables.has(t)) extraInTarget.push(t);

  return {
    prime_count: primeTables.size,
    target_count: targetTables.size,
    missing_in_target: missingInTarget.sort(),
    extra_in_target: extraInTarget.sort(),
    column_drift: columnDrift,
  };
}

function diffPolicies(prime: Snapshot, target: Snapshot) {
  const missingRls: string[] = [];
  const missingPolicies: Array<{ table: string; policies: string[] }> = [];

  for (const [tbl, enabled] of prime.rlsByTable) {
    const targetEnabled = target.rlsByTable.get(tbl);
    if (enabled && targetEnabled === false) missingRls.push(tbl);
  }

  for (const [tbl, primePolicies] of prime.policiesByTable) {
    const targetSet = new Set((target.policiesByTable.get(tbl) ?? []).map((r) => String(r.policyname)));
    const missing = primePolicies.map((r) => String(r.policyname)).filter((n) => !targetSet.has(n));
    if (missing.length) missingPolicies.push({ table: tbl, policies: missing });
  }

  return { rls_disabled_in_target: missingRls.sort(), missing_policies: missingPolicies };
}

function diffFunctions(prime: Snapshot, target: Snapshot) {
  const missing: string[] = [];
  const extra: string[] = [];
  for (const sig of prime.functionSigs) if (!target.functionSigs.has(sig)) missing.push(sig);
  for (const sig of target.functionSigs) if (!prime.functionSigs.has(sig)) extra.push(sig);
  return { missing_in_target: missing.sort(), extra_in_target: extra.sort() };
}

function diffExtensions(prime: Snapshot, target: Snapshot) {
  const missing: string[] = [];
  const versionSkew: Array<{ name: string; prime: string; target: string }> = [];
  for (const [name, ver] of prime.extensions) {
    const t = target.extensions.get(name);
    if (t === undefined) missing.push(name);
    else if (t !== ver) versionSkew.push({ name, prime: ver, target: t });
  }
  return { missing_in_target: missing.sort(), version_skew: versionSkew };
}

// ── G3 surfaces ───────────────────────────────────────────────────────

function diffBuckets(prime: Snapshot, target: Snapshot) {
  const missing: string[] = [];
  const configDrift: Array<{
    id: string;
    field: "public" | "file_size_limit" | "allowed_mime_types";
    prime: unknown;
    target: unknown;
  }> = [];
  const extra: string[] = [];

  for (const [id, pb] of prime.bucketsById) {
    const tb = target.bucketsById.get(id);
    if (!tb) {
      missing.push(id);
      continue;
    }
    if (pb.public !== tb.public) {
      configDrift.push({ id, field: "public", prime: pb.public, target: tb.public });
    }
    if ((pb.file_size_limit ?? null) !== (tb.file_size_limit ?? null)) {
      configDrift.push({ id, field: "file_size_limit", prime: pb.file_size_limit, target: tb.file_size_limit });
    }
    const pm = JSON.stringify((pb.allowed_mime_types ?? []).slice().sort());
    const tm = JSON.stringify((tb.allowed_mime_types ?? []).slice().sort());
    if (pm !== tm) {
      configDrift.push({ id, field: "allowed_mime_types", prime: pb.allowed_mime_types, target: tb.allowed_mime_types });
    }
  }
  for (const id of target.bucketsById.keys()) if (!prime.bucketsById.has(id)) extra.push(id);

  return {
    prime_count: prime.bucketsById.size,
    target_count: target.bucketsById.size,
    missing_in_target: missing.sort(),
    extra_in_target: extra.sort(),
    config_drift: configDrift,
  };
}

function diffCron(prime: Snapshot, target: Snapshot) {
  const missing: string[] = [];
  const scheduleDrift: Array<{ jobname: string; prime: string; target: string }> = [];
  const activeDrift: Array<{ jobname: string; prime: boolean; target: boolean }> = [];
  const extra: string[] = [];

  for (const [name, pj] of prime.cronByName) {
    const tj = target.cronByName.get(name);
    if (!tj) {
      missing.push(name);
      continue;
    }
    if (pj.schedule !== tj.schedule) {
      scheduleDrift.push({ jobname: name, prime: pj.schedule, target: tj.schedule });
    }
    if (pj.active !== tj.active) {
      activeDrift.push({ jobname: name, prime: pj.active, target: tj.active });
    }
  }
  for (const name of target.cronByName.keys()) if (!prime.cronByName.has(name)) extra.push(name);

  return {
    prime_count: prime.cronByName.size,
    target_count: target.cronByName.size,
    missing_in_target: missing.sort(),
    extra_in_target: extra.sort(),
    schedule_drift: scheduleDrift,
    active_drift: activeDrift,
  };
}

function diffEdgeFunctions(prime: Snapshot, target: Snapshot) {
  const missing: string[] = [];
  const extra: string[] = [];
  for (const slug of prime.edgeFnSet) if (!target.edgeFnSet.has(slug)) missing.push(slug);
  for (const slug of target.edgeFnSet) if (!prime.edgeFnSet.has(slug)) extra.push(slug);
  return {
    prime_count: prime.edgeFnSet.size,
    target_count: target.edgeFnSet.size,
    missing_in_target: missing.sort(),
    extra_in_target: extra.sort(),
  };
}

function diffSecrets(prime: Snapshot, target: Snapshot) {
  // Names only — values are never read.
  const missing: string[] = [];
  const extra: string[] = [];
  for (const name of prime.secretSet) if (!target.secretSet.has(name)) missing.push(name);
  for (const name of target.secretSet) if (!prime.secretSet.has(name)) extra.push(name);
  return {
    prime_count: prime.secretSet.size,
    target_count: target.secretSet.size,
    missing_in_target: missing.sort(),
    extra_in_target: extra.sort(),
  };
}

// Only compare a whitelisted subset of the auth config. OAuth provider
// credentials, SMTP passwords, and other secrets are excluded by design.
const AUTH_FIELDS_TO_COMPARE = [
  "site_url",
  "uri_allow_list",
  "jwt_exp",
  "disable_signup",
  "mailer_autoconfirm",
  "password_min_length",
  "external_email_enabled",
  "external_phone_enabled",
] as const;

function diffAuthConfig(prime: Snapshot, target: Snapshot) {
  const drift: Array<{ field: string; prime: unknown; target: unknown }> = [];
  for (const field of AUTH_FIELDS_TO_COMPARE) {
    const pv = (prime.authCfg as Record<string, unknown>)[field] ?? null;
    const tv = (target.authCfg as Record<string, unknown>)[field] ?? null;
    if (JSON.stringify(pv) !== JSON.stringify(tv)) {
      drift.push({ field, prime: pv, target: tv });
    }
  }
  return { drift };
}

// G4 — required extensions must be enabled on the target.
function diffRequiredExtensions(target: Snapshot) {
  const missing = REQUIRED_EXTENSIONS.filter((n) => !target.extensions.has(n));
  return { required: [...REQUIRED_EXTENSIONS], missing_in_target: missing };
}

// G4 — realtime publication membership parity.
function diffRealtime(prime: Snapshot, target: Snapshot) {
  const missing: string[] = [];
  const extra: string[] = [];
  for (const q of prime.realtimeSet) if (!target.realtimeSet.has(q)) missing.push(q);
  for (const q of target.realtimeSet) if (!prime.realtimeSet.has(q)) extra.push(q);
  return {
    prime_count: prime.realtimeSet.size,
    target_count: target.realtimeSet.size,
    missing_in_target: missing.sort(),
    extra_in_target: extra.sort(),
  };
}

// ── Public entry ──────────────────────────────────────────────────────

export type ParityResult = {
  prime_ref: string;
  target_ref: string;
  tables_diff: ReturnType<typeof diffTables>;
  policies_diff: ReturnType<typeof diffPolicies>;
  functions_diff: ReturnType<typeof diffFunctions>;
  extensions_diff: ReturnType<typeof diffExtensions>;
  buckets_diff: ReturnType<typeof diffBuckets>;
  cron_diff: ReturnType<typeof diffCron>;
  edge_functions_diff: ReturnType<typeof diffEdgeFunctions>;
  secrets_diff: ReturnType<typeof diffSecrets>;
  auth_config_diff: ReturnType<typeof diffAuthConfig>;
  required_extensions_diff: ReturnType<typeof diffRequiredExtensions>;
  realtime_diff: ReturnType<typeof diffRealtime>;
  blocking_issues: string[];
  risk_level: "low" | "medium" | "high" | "blocking";
  summary: string;
};

export async function computeParity(primeRef: string, targetRef: string): Promise<ParityResult> {
  const [prime, target] = await Promise.all([snapshotProject(primeRef), snapshotProject(targetRef)]);

  const tables = diffTables(prime, target);
  const policies = diffPolicies(prime, target);
  const functions = diffFunctions(prime, target);
  const extensions = diffExtensions(prime, target);
  const buckets = diffBuckets(prime, target);
  const cron = diffCron(prime, target);
  const edgeFns = diffEdgeFunctions(prime, target);
  const secrets = diffSecrets(prime, target);
  const authCfg = diffAuthConfig(prime, target);
  const requiredExt = diffRequiredExtensions(target);
  const realtime = diffRealtime(prime, target);

  const blocking: string[] = [];
  if (tables.missing_in_target.length) blocking.push(`missing_tables:${tables.missing_in_target.length}`);
  if (tables.column_drift.some((c) => c.missing.length || c.typeChanges.length)) blocking.push("column_drift");
  if (policies.rls_disabled_in_target.length) blocking.push(`rls_disabled:${policies.rls_disabled_in_target.length}`);
  if (policies.missing_policies.length) blocking.push(`missing_policies:${policies.missing_policies.length}`);
  if (functions.missing_in_target.length) blocking.push(`missing_functions:${functions.missing_in_target.length}`);
  if (extensions.missing_in_target.length) blocking.push(`missing_extensions:${extensions.missing_in_target.length}`);
  if (buckets.missing_in_target.length) blocking.push(`missing_buckets:${buckets.missing_in_target.length}`);
  if (secrets.missing_in_target.length) blocking.push(`missing_secrets:${secrets.missing_in_target.length}`);
  if (edgeFns.missing_in_target.length) blocking.push(`missing_edge_functions:${edgeFns.missing_in_target.length}`);
  if (requiredExt.missing_in_target.length) blocking.push(`missing_required_extensions:${requiredExt.missing_in_target.length}`);
  if (realtime.missing_in_target.length) blocking.push(`missing_realtime_tables:${realtime.missing_in_target.length}`);


  let risk: ParityResult["risk_level"] = "low";
  if (
    extensions.version_skew.length ||
    tables.extra_in_target.length ||
    buckets.config_drift.length ||
    cron.missing_in_target.length ||
    cron.schedule_drift.length ||
    authCfg.drift.length
  ) {
    risk = "medium";
  }
  if (functions.extra_in_target.length || edgeFns.extra_in_target.length) risk = "medium";
  if (blocking.length) risk = "blocking";

  const summary =
    `prime=${tables.prime_count} tables / ${prime.functionSigs.size} fns / ` +
    `${buckets.prime_count} buckets / ${cron.prime_count} cron / ${edgeFns.prime_count} edge-fns / ` +
    `${secrets.prime_count} secrets · target=${tables.target_count} tables / ${target.functionSigs.size} fns / ` +
    `${buckets.target_count} buckets / ${cron.target_count} cron / ${edgeFns.target_count} edge-fns / ` +
    `${secrets.target_count} secrets · blocking=${blocking.length}`;

  return {
    prime_ref: primeRef,
    target_ref: targetRef,
    tables_diff: tables,
    policies_diff: policies,
    functions_diff: functions,
    extensions_diff: extensions,
    buckets_diff: buckets,
    cron_diff: cron,
    edge_functions_diff: edgeFns,
    secrets_diff: secrets,
    auth_config_diff: authCfg,
    required_extensions_diff: requiredExt,
    realtime_diff: realtime,
    blocking_issues: blocking,
    risk_level: risk,
    summary,
  };
}

  };
}
