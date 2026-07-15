// @ts-nocheck
/**
 * G1 — Handoff parity engine.
 *
 * Computes a structural diff between the prime Aurixa backend and a target
 * clone backend (or a client-owned Supabase project) so an admin can review
 * exactly what will move during a handoff before any physical action runs.
 *
 * Surfaces compared in this pass (schema + policies + functions + extensions):
 *   - Tables & columns in `public` (name, data type, is_nullable)
 *   - RLS enabled flag per table
 *   - RLS policy names per table (cmd + roles)
 *   - Database functions in `public` (name + args signature)
 *   - Installed extensions
 *
 * Round-2 will extend this file with:
 *   - Storage bucket parity (bucket_config vs target)
 *   - pg_cron job parity
 *   - Edge function slug parity
 *   - Secret keyset parity (names only, never values)
 *   - Auth config parity (providers, redirect URLs)
 */

import { runSqlOnProject } from "./backend-provisioning.server";

type Row = Record<string, unknown>;

// Supabase Management API's `POST /database/query` returns either
// `{ result: Row[] }` or a bare `Row[]` depending on version — normalize both.
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
  const [t, r, p, f, e] = await Promise.all([
    runSqlOnProject(ref, TABLES_SQL).then(rows),
    runSqlOnProject(ref, RLS_SQL).then(rows),
    runSqlOnProject(ref, POLICIES_SQL).then(rows),
    runSqlOnProject(ref, FUNCTIONS_SQL).then(rows),
    runSqlOnProject(ref, EXTENSIONS_SQL).then(rows),
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

  return { columnsByTable, rlsByTable, policiesByTable, functionSigs, extensions };
}

type Snapshot = Awaited<ReturnType<typeof snapshotProject>>;

// ── Diff computation ──────────────────────────────────────────────────

function diffTables(prime: Snapshot, target: Snapshot) {
  const primeTables = new Set(prime.columnsByTable.keys());
  const targetTables = new Set(target.columnsByTable.keys());

  const missingInTarget: string[] = [];
  const extraInTarget: string[] = [];
  const columnDrift: Array<{ table: string; missing: string[]; extra: string[]; typeChanges: Array<{ column: string; prime: string; target: string }> }> = [];

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

// ── Public entry ──────────────────────────────────────────────────────

export type ParityResult = {
  prime_ref: string;
  target_ref: string;
  tables_diff: ReturnType<typeof diffTables>;
  policies_diff: ReturnType<typeof diffPolicies>;
  functions_diff: ReturnType<typeof diffFunctions>;
  extensions_diff: ReturnType<typeof diffExtensions>;
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

  const blocking: string[] = [];
  if (tables.missing_in_target.length) blocking.push(`missing_tables:${tables.missing_in_target.length}`);
  if (tables.column_drift.some((c) => c.missing.length || c.typeChanges.length))
    blocking.push("column_drift");
  if (policies.rls_disabled_in_target.length) blocking.push(`rls_disabled:${policies.rls_disabled_in_target.length}`);
  if (policies.missing_policies.length) blocking.push(`missing_policies:${policies.missing_policies.length}`);
  if (functions.missing_in_target.length) blocking.push(`missing_functions:${functions.missing_in_target.length}`);
  if (extensions.missing_in_target.length) blocking.push(`missing_extensions:${extensions.missing_in_target.length}`);

  let risk: ParityResult["risk_level"] = "low";
  if (extensions.version_skew.length || tables.extra_in_target.length) risk = "medium";
  if (functions.extra_in_target.length) risk = "medium";
  if (blocking.length) risk = "blocking";

  const summary =
    `prime=${tables.prime_count} tables / ${prime.functionSigs.size} fns · ` +
    `target=${tables.target_count} tables / ${target.functionSigs.size} fns · ` +
    `blocking=${blocking.length}`;

  return {
    prime_ref: primeRef,
    target_ref: targetRef,
    tables_diff: tables,
    policies_diff: policies,
    functions_diff: functions,
    extensions_diff: extensions,
    blocking_issues: blocking,
    risk_level: risk,
    summary,
  };
}
