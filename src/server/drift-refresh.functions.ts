import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getAppOctokit } from "./github-app.server";
import type { Database } from "@/integrations/supabase/types";

// Lightweight drift refresh — computes real commits_behind for each clone
// using GitHub's compareCommitsWithBasehead. Cheap enough to run on every
// /fleet-manager mount and on a 5-minute interval. Skips the AI step that
// triggerFleetDriftScan does — that remains an opt-in deeper analysis.

type SyncStatus = Database["public"]["Enums"]["sync_status"];

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

export const refreshFleetDrift = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DriftRefreshResult> => {
    const { supabase } = context;

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

    // Resolve prime HEAD once
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

    // Fan out per-clone in parallel — each clone is one or two GitHub calls
    await Promise.all(
      clones.map(async (c) => {
        try {
          // We compare prime SHA vs clone's last_synced_sha if known,
          // else clone's default-branch HEAD.
          let baseSha = c.last_synced_sha;
          if (!baseSha) {
            const { data: br } = await octokit.repos.getBranch({
              owner: c.github_owner,
              repo: c.github_repo,
              branch: c.default_branch || "main",
            });
            baseSha = br.commit.sha;
          }

          // Compare base...head — base is the clone, head is prime.
          // Result.ahead_by = how many commits prime has that clone doesn't,
          // i.e. commits_behind for the clone.
          const { data: cmp } = await octokit.repos.compareCommitsWithBasehead({
            owner: prime.github_owner,
            repo: prime.github_repo,
            basehead: `${baseSha}...${primeSha}`,
          });
          const behind = cmp.ahead_by ?? 0;

          let status: SyncStatus;
          if (c.sync_status === "failed") status = "failed"; // sticky until cleared by a successful cascade
          else if (c.sync_status === "cascading") status = "cascading";
          else if (behind === 0) status = "in_sync";
          else status = "behind";

          if (
            behind !== c.commits_behind ||
            status !== c.sync_status ||
            !c.last_drift_check_at
          ) {
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
          // Mark as failed only if the clone was previously reachable; otherwise leave alone
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
  });
