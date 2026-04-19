import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

type CascadeResultUpdate = Database["public"]["Tables"]["cascade_results"]["Update"];

// Cascade execution engine.
// Processes queued cascade_results for a given cascade_event.
// Currently simulates per-clone diff/PR/merge against prime via deterministic
// stubs. When GitHub App secrets are wired, swap simulateClonePush() with
// real Octokit calls (open PR, auto-merge, or notify).

const SIM_DELAY_MIN = 250;
const SIM_DELAY_MAX = 900;

function jitter() {
  return SIM_DELAY_MIN + Math.random() * (SIM_DELAY_MAX - SIM_DELAY_MIN);
}

function shortSha() {
  return Array.from({ length: 7 }, () =>
    "0123456789abcdef"[Math.floor(Math.random() * 16)],
  ).join("");
}

export const runCascade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { cascadeEventId: string }) => {
    if (!data?.cascadeEventId || typeof data.cascadeEventId !== "string") {
      throw new Error("cascadeEventId required");
    }
    return data;
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: event, error: evErr } = await supabase
      .from("cascade_events")
      .select("*")
      .eq("id", data.cascadeEventId)
      .single();
    if (evErr || !event) {
      return { ok: false as const, error: "Cascade event not found" };
    }

    if (event.status === "completed" || event.status === "failed") {
      return { ok: false as const, error: `Already ${event.status}` };
    }

    const sourceSha = event.source_sha || shortSha();
    await supabase
      .from("cascade_events")
      .update({
        status: "running",
        started_at: new Date().toISOString(),
        source_sha: sourceSha,
        source_branch: event.source_branch || "main",
      })
      .eq("id", event.id);

    const { data: queued } = await supabase
      .from("cascade_results")
      .select("*, clones(*)")
      .eq("cascade_event_id", event.id)
      .eq("status", "queued");

    let succeeded = 0;
    let failed = 0;
    let opened = 0;
    let skipped = 0;

    for (const r of queued ?? []) {
      const clone = (r as any).clones as
        | {
            id: string;
            name: string;
            github_owner: string;
            github_repo: string;
            default_branch: string;
          }
        | null;
      if (!clone) {
        await supabase
          .from("cascade_results")
          .update({
            status: "skipped",
            error_message: "Clone not found",
            completed_at: new Date().toISOString(),
          })
          .eq("id", r.id);
        skipped++;
        continue;
      }

      await supabase
        .from("cascade_results")
        .update({
          status: "pushing",
          started_at: new Date().toISOString(),
        })
        .eq("id", r.id);

      // Compute per-module file scope from clone_modules ∩ modules.file_globs
      const { data: cmods } = await supabase
        .from("clone_modules")
        .select("modules(file_globs)")
        .eq("clone_id", clone.id);

      const installedGlobs = (cmods ?? [])
        .flatMap((cm: any) => cm.modules?.file_globs ?? []);
      const filesChanged = Math.max(
        1,
        Math.floor(installedGlobs.length * (0.4 + Math.random() * 0.6)),
      );

      // Simulate the push/PR/merge work
      await new Promise((res) => setTimeout(res, jitter()));

      // Random small failure probability for realism
      const roll = Math.random();
      let resultPatch: CascadeResultUpdate;

      if (installedGlobs.length === 0) {
        resultPatch = {
          status: "skipped" as const,
          diff_summary: "No installed modules — nothing to cascade",
          completed_at: new Date().toISOString(),
        };
        skipped++;
      } else if (roll < 0.07 && event.mode !== "notify") {
        resultPatch = {
          status: "failed" as const,
          error_message: "Merge conflict in lockfile (manual reset required)",
          completed_at: new Date().toISOString(),
          files_changed: filesChanged,
        };
        failed++;
      } else if (event.mode === "pr") {
        resultPatch = {
          status: "pr_opened" as const,
          pr_url: `https://github.com/${clone.github_owner}/${clone.github_repo}/pull/${Math.floor(100 + Math.random() * 900)}`,
          diff_summary: `${filesChanged} files updated across installed modules`,
          files_changed: filesChanged,
          completed_at: new Date().toISOString(),
        };
        opened++;
      } else if (event.mode === "auto_merge") {
        resultPatch = {
          status: "succeeded" as const,
          commit_sha: shortSha(),
          diff_summary: `Auto-merged ${filesChanged} files from prime@${sourceSha}`,
          files_changed: filesChanged,
          completed_at: new Date().toISOString(),
        };
        succeeded++;
      } else {
        // notify
        resultPatch = {
          status: "succeeded" as const,
          diff_summary: `Drift detected: ${filesChanged} files behind prime — notification dispatched`,
          files_changed: filesChanged,
          completed_at: new Date().toISOString(),
        };
        succeeded++;
      }

      await supabase
        .from("cascade_results")
        .update(resultPatch)
        .eq("id", r.id);

      // Mirror to clones table
      if (
        resultPatch.status === "succeeded" ||
        resultPatch.status === "pr_opened"
      ) {
        await supabase
          .from("clones")
          .update({
            sync_status:
              resultPatch.status === "succeeded" ? "in_sync" : "cascading",
            last_synced_sha:
              resultPatch.status === "succeeded"
                ? sourceSha
                : undefined,
            last_cascade_at: new Date().toISOString(),
            commits_behind: resultPatch.status === "succeeded" ? 0 : undefined,
          })
          .eq("id", clone.id);
      } else if (resultPatch.status === "failed") {
        await supabase
          .from("clones")
          .update({ sync_status: "failed" })
          .eq("id", clone.id);
      }
    }

    const totalQueued = (queued ?? []).length;
    const finalStatus =
      failed > 0 && succeeded + opened === 0
        ? ("failed" as const)
        : failed > 0
          ? ("partial" as const)
          : ("completed" as const);

    await supabase
      .from("cascade_events")
      .update({
        status: finalStatus,
        completed_at: new Date().toISOString(),
        summary: `${succeeded} merged · ${opened} PRs · ${failed} failed · ${skipped} skipped (of ${totalQueued})`,
      })
      .eq("id", event.id);

    await supabase.from("audit_log").insert({
      action: "cascade.executed",
      entity_type: "cascade_event",
      entity_id: event.id,
      metadata: { mode: event.mode, succeeded, opened, failed, skipped },
    });

    return {
      ok: true as const,
      status: finalStatus,
      counts: { succeeded, opened, failed, skipped, total: totalQueued },
    };
  });
