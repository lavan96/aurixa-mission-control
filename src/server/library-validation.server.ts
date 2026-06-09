// Server-only pin validation helper used by the cascade engine.
// Mirrors the validateClonePins server function but takes a SupabaseClient
// directly so it can be invoked from background flows (webhooks, cron).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type PinIssue = {
  cloneId: string;
  slug: string;
  version: number;
  severity: "error" | "warning";
  reason: string;
};

export async function validateClonePinsServer(
  supabase: SupabaseClient<Database>,
  cloneIds: string[],
): Promise<{ ok: boolean; issues: PinIssue[]; checked: number; error?: string }> {
  if (cloneIds.length === 0) return { ok: true, issues: [], checked: 0 };

  const { data: pins, error } = await supabase
    .from("clone_library_pins")
    .select("id, clone_id, slug, version, library_entry_id")
    .in("clone_id", cloneIds);
  if (error) return { ok: false, issues: [], checked: 0, error: error.message };

  const pinRows = (pins ?? []) as Array<{
    id: string;
    clone_id: string;
    slug: string;
    version: number;
    library_entry_id: string;
  }>;
  if (pinRows.length === 0) return { ok: true, issues: [], checked: 0 };

  const entryIds = Array.from(new Set(pinRows.map((p) => p.library_entry_id)));
  const { data: entries } = await supabase
    .from("module_library")
    .select("id, approval_status, file_paths")
    .in("id", entryIds);

  const entryMap = new Map<string, { approval_status: string; file_paths: string[] | null }>();
  for (const e of (entries ?? []) as Array<{
    id: string;
    approval_status: string;
    file_paths: string[] | null;
  }>) {
    entryMap.set(e.id, { approval_status: e.approval_status, file_paths: e.file_paths });
  }

  const issues: PinIssue[] = [];
  for (const p of pinRows) {
    const e = entryMap.get(p.library_entry_id);
    if (!e) {
      issues.push({
        cloneId: p.clone_id,
        slug: p.slug,
        version: p.version,
        severity: "error",
        reason: "Library entry was deleted",
      });
      continue;
    }
    if (e.approval_status !== "approved") {
      issues.push({
        cloneId: p.clone_id,
        slug: p.slug,
        version: p.version,
        severity: "error",
        reason: `Entry is now ${e.approval_status}`,
      });
    }
    if ((e.file_paths ?? []).length === 0) {
      issues.push({
        cloneId: p.clone_id,
        slug: p.slug,
        version: p.version,
        severity: "error",
        reason: "Pinned entry has no file paths",
      });
    }
  }

  return { ok: true, issues, checked: pinRows.length };
}
