// Pre-cascade dry-run: for the chosen mode/scope, walk each clone's installed
// modules, list which prime files differ, and return a green/yellow/red impact
// matrix. AI summary is generated from the aggregate file list so callers can
// preview the blast before firing.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  getAppOctokit,
  listFilesMatchingGlobs,
  getFileContent,
  type RepoRef,
} from "./github-app.server";

type SupabaseLike = SupabaseClient<Database>;

export type ImpactLevel = "green" | "yellow" | "red";

export type CloneImpact = {
  cloneId: string;
  name: string;
  level: ImpactLevel;
  filesChanged: number;
  filesInScope: number;
  installedModules: number;
  reason: string;
};

export type DryRunResult =
  | {
      ok: true;
      cloneImpacts: CloneImpact[];
      totals: { green: number; yellow: number; red: number; totalFilesChanged: number };
      sourceSha: string;
      aiSummary: string | null;
    }
  | { ok: false; error: string };

const MAX_CLONES_TO_DRYRUN = 25;
const MAX_FILES_TO_PROBE_PER_CLONE = 30;

function classify(filesChanged: number, installedModules: number): ImpactLevel {
  if (filesChanged === 0) return "green";
  if (installedModules === 0) return "green";
  if (filesChanged > 15) return "red";
  if (filesChanged > 4) return "yellow";
  return "yellow";
}

export async function runCascadeDryRun(
  supabase: SupabaseLike,
  opts: { cloneIds?: string[] },
): Promise<DryRunResult> {
  let octokit;
  try {
    octokit = getAppOctokit();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "GitHub App not configured" };
  }

  const { data: prime } = await supabase.from("prime_config").select("*").limit(1).maybeSingle();
  if (!prime) return { ok: false, error: "Prime not configured" };

  let clonesQuery = supabase.from("clones").select("id, name, github_owner, github_repo, default_branch");
  if (opts.cloneIds && opts.cloneIds.length > 0) {
    clonesQuery = clonesQuery.in("id", opts.cloneIds);
  }
  const { data: clones } = await clonesQuery;
  if (!clones || clones.length === 0) return { ok: false, error: "No clones in scope" };

  const limited = clones.slice(0, MAX_CLONES_TO_DRYRUN);

  const primeRef: RepoRef = {
    owner: prime.github_owner,
    repo: prime.github_repo,
    branch: prime.default_branch || "main",
  };

  let sourceSha = "";
  try {
    const { data: br } = await octokit.repos.getBranch({
      owner: primeRef.owner,
      repo: primeRef.repo,
      branch: primeRef.branch,
    });
    sourceSha = br.commit.sha;
  } catch (e) {
    return { ok: false, error: `Cannot read prime: ${e instanceof Error ? e.message : "unknown"}` };
  }

  // Pull installed modules for each clone in one shot.
  const { data: cmRows } = await supabase
    .from("clone_modules")
    .select("clone_id, modules(file_globs)")
    .in("clone_id", limited.map((c) => c.id));

  const cloneToGlobs = new Map<string, string[]>();
  const cloneToModuleCount = new Map<string, number>();
  for (const row of cmRows ?? []) {
    const cmRow = row as { clone_id: string; modules: { file_globs: string[] | null } | null };
    const globs = cmRow.modules?.file_globs ?? [];
    if (!cloneToGlobs.has(cmRow.clone_id)) cloneToGlobs.set(cmRow.clone_id, []);
    cloneToGlobs.get(cmRow.clone_id)!.push(...globs);
    cloneToModuleCount.set(cmRow.clone_id, (cloneToModuleCount.get(cmRow.clone_id) ?? 0) + 1);
  }

  const impacts: CloneImpact[] = [];
  for (const clone of limited) {
    const globs = cloneToGlobs.get(clone.id) ?? [];
    const modCount = cloneToModuleCount.get(clone.id) ?? 0;
    if (globs.length === 0) {
      impacts.push({
        cloneId: clone.id,
        name: clone.name,
        level: "green",
        filesChanged: 0,
        filesInScope: 0,
        installedModules: 0,
        reason: "No modules installed — cascade would skip",
      });
      continue;
    }

    const cloneRef: RepoRef = {
      owner: clone.github_owner,
      repo: clone.github_repo,
      branch: clone.default_branch || "main",
    };

    let primeFiles: string[] = [];
    try {
      primeFiles = await listFilesMatchingGlobs(octokit, primeRef, globs);
    } catch {
      impacts.push({
        cloneId: clone.id,
        name: clone.name,
        level: "red",
        filesChanged: 0,
        filesInScope: 0,
        installedModules: modCount,
        reason: "Could not enumerate prime files",
      });
      continue;
    }

    if (primeFiles.length === 0) {
      impacts.push({
        cloneId: clone.id,
        name: clone.name,
        level: "green",
        filesChanged: 0,
        filesInScope: 0,
        installedModules: modCount,
        reason: "No files match installed module globs",
      });
      continue;
    }

    const probeFiles = primeFiles.slice(0, MAX_FILES_TO_PROBE_PER_CLONE);
    let changed = 0;
    try {
      for (const path of probeFiles) {
        const [pf, cf] = await Promise.all([
          getFileContent(octokit, primeRef, path),
          getFileContent(octokit, cloneRef, path),
        ]);
        if (!pf) continue;
        if (!cf || cf.content !== pf.content) changed++;
      }
    } catch {
      impacts.push({
        cloneId: clone.id,
        name: clone.name,
        level: "red",
        filesChanged: changed,
        filesInScope: primeFiles.length,
        installedModules: modCount,
        reason: "Clone unreachable on GitHub",
      });
      continue;
    }

    const level = classify(changed, modCount);
    const reason =
      changed === 0
        ? "Clone matches prime — no changes will be pushed"
        : level === "red"
          ? `${changed} files differ — large blast radius`
          : `${changed} files differ across ${modCount} module${modCount === 1 ? "" : "s"}`;
    impacts.push({
      cloneId: clone.id,
      name: clone.name,
      level,
      filesChanged: changed,
      filesInScope: primeFiles.length,
      installedModules: modCount,
      reason,
    });
  }

  const totals = impacts.reduce(
    (acc, i) => {
      acc[i.level]++;
      acc.totalFilesChanged += i.filesChanged;
      return acc;
    },
    { green: 0, yellow: 0, red: 0, totalFilesChanged: 0 },
  );

  // AI summary — best-effort. Fail open with null if no key or API errors.
  let aiSummary: string | null = null;
  const apiKey = process.env.LOVABLE_API_KEY;
  if (apiKey && totals.totalFilesChanged > 0) {
    try {
      const top = impacts
        .filter((i) => i.level !== "green")
        .slice(0, 12)
        .map((i) => `- ${i.name}: ${i.filesChanged}/${i.filesInScope} files differ (${i.level})`)
        .join("\n");
      const prompt =
        `You are summarizing a fleet cascade dry-run for an operator. ` +
        `Be terse (<= 2 short sentences). Highlight the riskiest clones and the magnitude. ` +
        `Avoid hedging.\n\nDry-run results from prime@${sourceSha.slice(0, 7)}:\n` +
        `Total clones probed: ${impacts.length} (green ${totals.green} · yellow ${totals.yellow} · red ${totals.red}).\n` +
        `Top impacted:\n${top || "(all green)"}`;
      const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: "You are a senior platform engineer. Be concise." },
            { role: "user", content: prompt },
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

  return { ok: true, cloneImpacts: impacts, totals, sourceSha, aiSummary };
}
