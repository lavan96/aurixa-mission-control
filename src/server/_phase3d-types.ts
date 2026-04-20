// TEMPORARY: type shims for tables added in the Phase 3D migration.
// The auto-generated supabase/types.ts is regenerated asynchronously and may
// briefly lag behind a fresh migration. Once it catches up, these shims are
// just synonyms — the casts remain safe because they widen one client type
// into another that simply knows about extra tables.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";

type CascadeMode = Database["public"]["Enums"]["cascade_mode"];

export type { Json };

export type ScheduleKind = "fleet_cascade" | "module_sync";
export type DriftSeverity = "low" | "medium" | "high";

export type CascadeScheduleRow = {
  id: string;
  name: string;
  kind: ScheduleKind;
  cron_expression: string;
  mode: CascadeMode;
  scope_filter: Json;
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  last_cascade_event_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CloneDriftPolicyRow = {
  id: string;
  clone_id: string;
  enabled: boolean;
  auto_apply_severity: DriftSeverity;
  max_per_run: number;
  cascade_mode: CascadeMode;
  muted_kinds: string[];
  last_applied_at: string | null;
  last_applied_count: number;
  created_at: string;
  updated_at: string;
};

// Untyped wrapper for tables not yet in Database. Returns the standard
// PostgrestQueryBuilder so callers can chain insert/update/select normally.
// We cast through `unknown` to escape the strict Database table union.
export function unknownTable<T = unknown>(
  supabase: SupabaseClient<Database>,
  table: string,
): {
  select: (columns?: string) => any;
  insert: (rows: unknown) => any;
  update: (patch: unknown) => any;
  upsert: (rows: unknown, opts?: { onConflict?: string }) => any;
  delete: () => any;
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase as any).from(table) as any;
}

export type SupabaseLike = SupabaseClient<Database>;
