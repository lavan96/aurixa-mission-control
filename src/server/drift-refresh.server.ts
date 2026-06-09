import { getAppOctokit } from "./github-app.server";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";

// Lightweight drift refresh — computes real commits_behind for each clone
// using GitHub's compareCommitsWithBasehead. Server-only.

type SyncStatus = Database["public"]["Enums"]["sync_status"];
type SupabaseLike = SupabaseClient<Database>;

export type DriftRefreshResult = {
  ok: boolean;
  scanned: number;
  updated: number;
  error?: string;
  per_clone: Array<{
    id: string;
    name: string;
    commits_behind: number;
    sync_status: SyncStatus;
    error?: string;
  }>;
};

/**
 * Pure drift-refresh logic. Accepts any Supabase client (user-scoped or admin)
 * so it can be invoked from a server function (with RLS as the operator) OR
 * from a cron-triggered hook (with the service role key).
 */
export async function runDriftRefresh(supabase: SupabaseLike): Promise<DriftRefreshResult> {
  let octokit;
  try {
    octokit = getAppOctokit();
  } catch (e) {
    return {
      ok: false,
      scanned: 0,
      updated: 0,
      error: e instanceof Error ? e.message : "GitHub App not configured",
      per_clone: [],
    };
  }

  const [primeRes, clonesRes] = await Promise.all([
    supabase.from("prime_config").select("*").limit(1).maybeSingle(),
    supabase.from("clones").select("*"),
  ]);
  const prime = primeRes.data;
  if (!prime) {
    return {
      ok: false,
      scanned: 0,
      updated: 0,
      error: "Prime not configured",
      per_clone: [],
    };
  }
  const clones = clonesRes.data ?? [];
  if (clones.length === 0) {
    return { ok: true, scanned: 0, updated: 0, per_clone: [] };
  }

  let primeSha: string;
  try {
    const { data: br } = await octokit.repos.getBranch({
      owner: prime.github_owner,
      repo: prime.github_repo,
      branch: prime.default_branch || "main",
    });
    primeSha = br.commit.sha;
  } catch (e) {
    return {
      ok: false,
      scanned: 0,
      updated: 0,
      error: `Cannot read prime: ${e instanceof Error ? e.message : "unknown"}`,
      per_clone: [],
    };
  }

  let updated = 0;
  const per_clone: DriftRefreshResult["per_clone"] = [];

  await Promise.all(
    clones.map(async (c) => {
      try {
        let baseSha = c.last_synced_sha;
        if (!baseSha) {
          const { data: br } = await octokit.repos.getBranch({
            owner: c.github_owner,
            repo: c.github_repo,
            branch: c.default_branch || "main",
          });
          baseSha = br.commit.sha;
        }

        const { data: cmp } = await octokit.repos.compareCommitsWithBasehead({
          owner: prime.github_owner,
          repo: prime.github_repo,
          basehead: `${baseSha}...${primeSha}`,
        });
        const behind = cmp.ahead_by ?? 0;

        let status: SyncStatus;
        if (c.sync_status === "failed") status = "failed";
        else if (c.sync_status === "cascading") status = "cascading";
        else if (behind === 0) status = "in_sync";
        else status = "behind";

        if (behind !== c.commits_behind || status !== c.sync_status || !c.last_drift_check_at) {
          await supabase
            .from("clones")
            .update({
              commits_behind: behind,
              sync_status: status,
              last_drift_check_at: new Date().toISOString(),
            })
            .eq("id", c.id);
          updated++;
        } else {
          await supabase
            .from("clones")
            .update({ last_drift_check_at: new Date().toISOString() })
            .eq("id", c.id);
        }

        per_clone.push({
          id: c.id,
          name: c.name,
          commits_behind: behind,
          sync_status: status,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unreachable";
        await supabase
          .from("clones")
          .update({
            sync_status: "failed",
            last_drift_check_at: new Date().toISOString(),
          })
          .eq("id", c.id);
        per_clone.push({
          id: c.id,
          name: c.name,
          commits_behind: c.commits_behind,
          sync_status: "failed",
          error: msg,
        });
        updated++;
      }
    }),
  );

  return {
    ok: true,
    scanned: clones.length,
    updated,
    per_clone,
  };
}
