import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  getAppOctokit,
  listFilesMatchingGlobs,
  getFileContent,
  type RepoRef,
} from "./github-app.server";

type CascadeResultUpdate = Database["public"]["Tables"]["cascade_results"]["Update"];

// Real cascade execution engine backed by the Aurixa GitHub App.
// Per cascade_event: resolve prime HEAD, then for each queued cascade_result
// (one per clone) compute the per-clone module file scope, mirror prime files
// onto a fresh branch, and either open a PR, auto-merge, or post a notify
// comment depending on event.mode.

function shortSha(sha: string) {
  return sha.slice(0, 7);
}

function branchName(sourceSha: string) {
  return `aurixa/cascade-${shortSha(sourceSha)}-${Date.now().toString(36)}`;
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

    // Load event + prime config + queued results in parallel
    const [eventRes, primeRes, queuedRes] = await Promise.all([
      supabase.from("cascade_events").select("*").eq("id", data.cascadeEventId).single(),
      supabase.from("prime_config").select("*").limit(1).maybeSingle(),
      supabase
        .from("cascade_results")
        .select("*, clones(*)")
        .eq("cascade_event_id", data.cascadeEventId)
        .eq("status", "queued"),
    ]);

    const event = eventRes.data;
    if (eventRes.error || !event) {
      return { ok: false as const, error: "Cascade event not found" };
    }
    if (event.status === "completed" || event.status === "failed") {
      return { ok: false as const, error: `Already ${event.status}` };
    }
    const prime = primeRes.data;
    if (!prime) {
      return {
        ok: false as const,
        error: "Prime not configured — set it up in Settings first",
      };
    }

    let octokit;
    try {
      octokit = getAppOctokit();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "GitHub App not configured";
      await supabase
        .from("cascade_events")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          summary: msg,
        })
        .eq("id", event.id);
      return { ok: false as const, error: msg };
    }

    // Resolve prime HEAD SHA
    const primeRef: RepoRef = {
      owner: prime.github_owner,
      repo: prime.github_repo,
      branch: event.source_branch || prime.default_branch || "main",
    };
    let sourceSha: string;
    try {
      const { data: br } = await octokit.repos.getBranch({
        owner: primeRef.owner,
        repo: primeRef.repo,
        branch: primeRef.branch,
      });
      sourceSha = br.commit.sha;
    } catch (e) {
      const msg = `Cannot read prime ${primeRef.owner}/${primeRef.repo}@${primeRef.branch}: ${e instanceof Error ? e.message : "unknown"}`;
      await supabase
        .from("cascade_events")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          summary: msg,
        })
        .eq("id", event.id);
      return { ok: false as const, error: msg };
    }

    await supabase
      .from("cascade_events")
      .update({
        status: "running",
        started_at: new Date().toISOString(),
        source_sha: sourceSha,
        source_branch: primeRef.branch,
      })
      .eq("id", event.id);

    let succeeded = 0;
    let failed = 0;
    let opened = 0;
    let skipped = 0;

    for (const r of queuedRes.data ?? []) {
      const clone = (r as { clones: unknown }).clones as
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
        .update({ status: "pushing", started_at: new Date().toISOString() })
        .eq("id", r.id);

      try {
        const patch = await processClone({
          octokit,
          primeRef,
          sourceSha,
          mode: event.mode,
          clone,
          supabase,
          eventId: event.id,
        });

        await supabase.from("cascade_results").update(patch).eq("id", r.id);

        if (patch.status === "succeeded") succeeded++;
        else if (patch.status === "pr_opened") opened++;
        else if (patch.status === "failed") failed++;
        else if (patch.status === "skipped") skipped++;

        // Mirror to clones table
        if (patch.status === "succeeded" || patch.status === "pr_opened") {
          await supabase
            .from("clones")
            .update({
              sync_status:
                patch.status === "succeeded" ? "in_sync" : "cascading",
              last_synced_sha: patch.status === "succeeded" ? sourceSha : undefined,
              last_cascade_at: new Date().toISOString(),
              commits_behind: patch.status === "succeeded" ? 0 : undefined,
            })
            .eq("id", clone.id);
        } else if (patch.status === "failed") {
          await supabase
            .from("clones")
            .update({ sync_status: "failed" })
            .eq("id", clone.id);
        }
      } catch (e) {
        failed++;
        await supabase
          .from("cascade_results")
          .update({
            status: "failed",
            error_message: e instanceof Error ? e.message : String(e),
            completed_at: new Date().toISOString(),
          })
          .eq("id", r.id);
        await supabase
          .from("clones")
          .update({ sync_status: "failed" })
          .eq("id", clone.id);
      }
    }

    const totalQueued = (queuedRes.data ?? []).length;
    const finalStatus =
      failed > 0 && succeeded + opened === 0
        ? ("failed" as const)
        : failed > 0
          ? ("partial" as const)
          : ("completed" as const);
    const summary = `${succeeded} merged · ${opened} PRs · ${failed} failed · ${skipped} skipped (of ${totalQueued})`;

    await supabase
      .from("cascade_events")
      .update({
        status: finalStatus,
        completed_at: new Date().toISOString(),
        summary,
      })
      .eq("id", event.id);

    await supabase.from("audit_log").insert({
      action: "cascade.executed",
      entity_type: "cascade_event",
      entity_id: event.id,
      metadata: { mode: event.mode, succeeded, opened, failed, skipped },
    });

    const kind =
      finalStatus === "completed"
        ? "cascade_completed"
        : finalStatus === "failed"
          ? "cascade_failed"
          : "cascade_partial";
    const severity =
      finalStatus === "completed"
        ? "success"
        : finalStatus === "failed"
          ? "error"
          : "warning";

    await supabase.from("notifications").insert({
      kind,
      severity,
      title: `Cascade ${finalStatus} (${event.mode})`,
      body: summary,
      cascade_event_id: event.id,
      url: `/cascades/${event.id}`,
      metadata: { mode: event.mode, succeeded, opened, failed, skipped },
    });

    type NotifInsert = Database["public"]["Tables"]["notifications"]["Insert"];
    const cloneNotifs: NotifInsert[] = [];
    for (const r of queuedRes.data ?? []) {
      const clone = (r as { clones: { id: string; name: string } | null }).clones;
      if (!clone) continue;
      cloneNotifs.push({
        kind,
        severity,
        title: `${clone.name} · ${event.mode.replace("_", " ")}`,
        body: summary,
        clone_id: clone.id,
        cascade_event_id: event.id,
        url: `/cascades/${event.id}`,
        metadata: { mode: event.mode },
      });
    }
    if (cloneNotifs.length > 0) {
      await supabase.from("notifications").insert(cloneNotifs);
    }

    return {
      ok: true as const,
      status: finalStatus,
      counts: { succeeded, opened, failed, skipped, total: totalQueued },
    };
  });

// ---------- per-clone worker ----------

async function processClone(args: {
  octokit: ReturnType<typeof getAppOctokit>;
  primeRef: RepoRef;
  sourceSha: string;
  mode: Database["public"]["Enums"]["cascade_mode"];
  clone: {
    id: string;
    name: string;
    github_owner: string;
    github_repo: string;
    default_branch: string;
  };
  supabase: SupabaseLike;
  eventId: string;
}): Promise<CascadeResultUpdate> {
  const { octokit, primeRef, sourceSha, mode, clone, supabase } = args;

  // Resolve installed module file globs
  const { data: cmods } = await supabase
    .from("clone_modules")
    .select("modules(file_globs)")
    .eq("clone_id", clone.id);

  const installedGlobs: string[] = (cmods ?? [])
    .flatMap((cm: { modules: { file_globs: string[] | null } | null }) =>
      cm.modules?.file_globs ?? [],
    );

  if (installedGlobs.length === 0) {
    return {
      status: "skipped",
      diff_summary: "No installed modules — nothing to cascade",
      completed_at: new Date().toISOString(),
    };
  }

  const cloneRef: RepoRef = {
    owner: clone.github_owner,
    repo: clone.github_repo,
    branch: clone.default_branch || "main",
  };

  // Validate clone branch exists
  let cloneBranchSha: string;
  try {
    const { data: br } = await octokit.repos.getBranch({
      owner: cloneRef.owner,
      repo: cloneRef.repo,
      branch: cloneRef.branch,
    });
    cloneBranchSha = br.commit.sha;
  } catch (e) {
    throw new Error(
      `Clone ${cloneRef.owner}/${cloneRef.repo}@${cloneRef.branch} unreachable: ${e instanceof Error ? e.message : "unknown"}`,
    );
  }

  // Files in prime that match installed module globs
  const primeFiles = await listFilesMatchingGlobs(octokit, primeRef, installedGlobs);

  if (mode === "notify") {
    // Just post a commit comment on clone HEAD flagging drift
    const body =
      `**Aurixa cascade — drift notice**\n\n` +
      `Prime ${primeRef.owner}/${primeRef.repo}@${shortSha(sourceSha)} ` +
      `has ${primeFiles.length} file(s) in your installed modules that may be behind.\n\n` +
      `_No commits were made. This is notify-only mode._`;
    await octokit.repos.createCommitComment({
      owner: cloneRef.owner,
      repo: cloneRef.repo,
      commit_sha: cloneBranchSha,
      body,
    });
    return {
      status: "succeeded",
      diff_summary: `Drift notification posted on ${shortSha(cloneBranchSha)} (${primeFiles.length} files in scope)`,
      files_changed: primeFiles.length,
      completed_at: new Date().toISOString(),
    };
  }

  // Compare prime → clone file by file, collect tree entries that actually differ
  const treeEntries: Array<{
    path: string;
    mode: "100644";
    type: "blob";
    sha: string | null;
  }> = [];

  for (const path of primeFiles) {
    const [primeFile, cloneFile] = await Promise.all([
      getFileContent(octokit, primeRef, path),
      getFileContent(octokit, cloneRef, path),
    ]);
    if (!primeFile) continue; // shouldn't happen — file was just listed
    if (cloneFile && cloneFile.content === primeFile.content) continue; // identical, skip

    // Create a blob in the clone repo for the prime content
    const { data: blob } = await octokit.git.createBlob({
      owner: cloneRef.owner,
      repo: cloneRef.repo,
      content: Buffer.from(primeFile.content, "utf8").toString("base64"),
      encoding: "base64",
    });
    treeEntries.push({
      path,
      mode: "100644",
      type: "blob",
      sha: blob.sha,
    });
  }

  if (treeEntries.length === 0) {
    return {
      status: "skipped",
      diff_summary: `Already in sync with prime@${shortSha(sourceSha)}`,
      completed_at: new Date().toISOString(),
    };
  }

  // Build a new tree on top of the clone's current tree
  const { data: cloneCommit } = await octokit.git.getCommit({
    owner: cloneRef.owner,
    repo: cloneRef.repo,
    commit_sha: cloneBranchSha,
  });
  const { data: newTree } = await octokit.git.createTree({
    owner: cloneRef.owner,
    repo: cloneRef.repo,
    base_tree: cloneCommit.tree.sha,
    tree: treeEntries,
  });

  const message =
    `chore(aurixa): cascade ${treeEntries.length} file(s) from prime@${shortSha(sourceSha)}\n\n` +
    treeEntries.map((t) => `- ${t.path}`).join("\n");

  const { data: newCommit } = await octokit.git.createCommit({
    owner: cloneRef.owner,
    repo: cloneRef.repo,
    message,
    tree: newTree.sha,
    parents: [cloneBranchSha],
  });

  const branch = branchName(sourceSha);
  await octokit.git.createRef({
    owner: cloneRef.owner,
    repo: cloneRef.repo,
    ref: `refs/heads/${branch}`,
    sha: newCommit.sha,
  });

  // Open the PR
  const { data: pr } = await octokit.pulls.create({
    owner: cloneRef.owner,
    repo: cloneRef.repo,
    title: `Aurixa cascade · prime@${shortSha(sourceSha)} → ${treeEntries.length} file(s)`,
    head: branch,
    base: cloneRef.branch,
    body:
      `Automated cascade from **${primeRef.owner}/${primeRef.repo}@${shortSha(sourceSha)}**.\n\n` +
      `Files synchronized (scoped to installed modules):\n\n` +
      treeEntries.map((t) => `- \`${t.path}\``).join("\n"),
  });

  if (mode === "auto_merge") {
    try {
      const { data: merged } = await octokit.pulls.merge({
        owner: cloneRef.owner,
        repo: cloneRef.repo,
        pull_number: pr.number,
        merge_method: "squash",
        commit_title: `Aurixa cascade prime@${shortSha(sourceSha)} (#${pr.number})`,
      });
      return {
        status: "succeeded",
        commit_sha: merged.sha?.slice(0, 7) ?? null,
        pr_url: pr.html_url,
        diff_summary: `Auto-merged ${treeEntries.length} files from prime@${shortSha(sourceSha)}`,
        files_changed: treeEntries.length,
        completed_at: new Date().toISOString(),
      };
    } catch (e) {
      // PR exists but merge failed (likely conflict / branch protection)
      return {
        status: "pr_opened",
        pr_url: pr.html_url,
        diff_summary: `Auto-merge blocked — PR left open for manual merge (${treeEntries.length} files)`,
        files_changed: treeEntries.length,
        error_message: e instanceof Error ? e.message : "Merge blocked",
        completed_at: new Date().toISOString(),
      };
    }
  }

  // mode === 'pr'
  return {
    status: "pr_opened",
    pr_url: pr.html_url,
    diff_summary: `${treeEntries.length} files updated across installed modules`,
    files_changed: treeEntries.length,
    completed_at: new Date().toISOString(),
  };
}
