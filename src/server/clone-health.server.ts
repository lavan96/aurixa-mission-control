// Per-clone health snapshot: deploy uptime ping, last successful cascade,
// and AI-summarized recent activity over the last 7 days.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { unknownTable } from "./_phase3d-types";

type SupabaseLike = SupabaseClient<Database>;

// 5-minute TTL — fresh enough that operators see meaningful changes,
// stale enough to make /health load instantly after the first probe.
export const HEALTH_SNAPSHOT_TTL_MS = 5 * 60 * 1000;

export async function readCachedCloneHealth(
  supabase: SupabaseLike,
  cloneId: string,
): Promise<{ payload: CloneHealth; probedAt: string } | null> {
  const { data } = await unknownTable(supabase, "clone_health_snapshots")
    .select("payload, probed_at")
    .eq("clone_id", cloneId)
    .maybeSingle();
  const row = data as { payload: CloneHealth; probed_at: string } | null;
  if (!row) return null;
  const age = Date.now() - new Date(row.probed_at).getTime();
  if (age > HEALTH_SNAPSHOT_TTL_MS) return null;
  return { payload: row.payload, probedAt: row.probed_at };
}

async function writeSnapshot(
  supabase: SupabaseLike,
  cloneId: string,
  payload: CloneHealth,
): Promise<void> {
  await unknownTable(supabase, "clone_health_snapshots").upsert(
    {
      clone_id: cloneId,
      payload: payload as unknown,
      probed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "clone_id" },
  );
}

export type CloneHealth = {
  cloneId: string;
  deployUrl: string | null;
  uptime: { status: "up" | "down" | "unknown"; httpStatus: number | null; latencyMs: number | null };
  lastSuccessfulCascadeAt: string | null;
  lastFailedCascadeAt: string | null;
  cascadeCount7d: number;
  failureCount7d: number;
  driftSuggestionsOpen: number;
  aiSummary: string | null;
};

const FETCH_TIMEOUT_MS = 4000;

async function pingDeploy(url: string): Promise<{ status: "up" | "down" | "unknown"; httpStatus: number | null; latencyMs: number | null }> {
  try {
    const t0 = Date.now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, { method: "HEAD", signal: ctl.signal, redirect: "follow" });
    clearTimeout(timer);
    const latency = Date.now() - t0;
    return {
      status: res.ok || res.status === 405 ? "up" : "down",
      httpStatus: res.status,
      latencyMs: latency,
    };
  } catch {
    return { status: "down", httpStatus: null, latencyMs: null };
  }
}

export async function getCloneHealth(
  supabase: SupabaseLike,
  cloneId: string,
  opts: { skipCache?: boolean } = {},
): Promise<CloneHealth> {
  if (!opts.skipCache) {
    const cached = await readCachedCloneHealth(supabase, cloneId);
    if (cached) return cached.payload;
  }
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: clone }, { data: results }, { data: audit }] = await Promise.all([
    supabase.from("clones").select("*").eq("id", cloneId).maybeSingle(),
    supabase
      .from("cascade_results")
      .select("status, completed_at, diff_summary, error_message")
      .eq("clone_id", cloneId)
      .gte("created_at", sevenDaysAgo)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("audit_log")
      .select("action, created_at, metadata")
      .eq("entity_type", "clone")
      .eq("entity_id", cloneId)
      .gte("created_at", sevenDaysAgo)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  let uptime: CloneHealth["uptime"] = { status: "unknown", httpStatus: null, latencyMs: null };
  if (clone?.deploy_url) {
    uptime = await pingDeploy(clone.deploy_url);
  }

  const succeeded = (results ?? []).filter(
    (r) => r.status === "succeeded" || r.status === "pr_opened",
  );
  const failed = (results ?? []).filter((r) => r.status === "failed");
  const lastSuccessfulCascadeAt = succeeded[0]?.completed_at ?? null;
  const lastFailedCascadeAt = failed[0]?.completed_at ?? null;

  const driftRaw = clone?.drift_suggestions as unknown as Array<{ status: string }> | null;
  const driftOpen = (driftRaw ?? []).filter((s) => s.status === "open").length;

  // AI-summarize recent activity. Best-effort.
  let aiSummary: string | null = null;
  const apiKey = process.env.LOVABLE_API_KEY;
  if (apiKey && (results?.length || audit?.length)) {
    try {
      const summaryInput =
        `Clone: ${clone?.name}\n` +
        `Sync status: ${clone?.sync_status} (${clone?.commits_behind ?? 0} behind)\n` +
        `Cascades (7d): ${results?.length ?? 0} total · ${succeeded.length} ok · ${failed.length} failed\n` +
        `Open drift suggestions: ${driftOpen}\n` +
        `Recent cascade results:\n` +
        (results ?? [])
          .slice(0, 8)
          .map((r) => `- [${r.status}] ${r.diff_summary ?? r.error_message ?? "(no detail)"}`)
          .join("\n") +
        `\n\nRecent audit events:\n` +
        (audit ?? [])
          .slice(0, 8)
          .map((a) => `- ${a.action}`)
          .join("\n");
      const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            {
              role: "system",
              content:
                "You are a senior SRE. Summarize this clone's last-week activity in 2 short sentences. Highlight risk if any. No hedging.",
            },
            { role: "user", content: summaryInput },
          ],
        }),
      });
      if (aiRes.ok) {
        const json = (await aiRes.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        aiSummary = json.choices?.[0]?.message?.content?.trim() ?? null;
      }
    } catch {
      // Non-fatal
    }
  }

  const result: CloneHealth = {
    cloneId,
    deployUrl: clone?.deploy_url ?? null,
    uptime,
    lastSuccessfulCascadeAt,
    lastFailedCascadeAt,
    cascadeCount7d: results?.length ?? 0,
    failureCount7d: failed.length,
    driftSuggestionsOpen: driftOpen,
    aiSummary,
  };

  // Best-effort cache write — failure here must not break the dashboard.
  try {
    await writeSnapshot(supabase, cloneId, result);
  } catch {
    // ignore
  }

  return result;
}
