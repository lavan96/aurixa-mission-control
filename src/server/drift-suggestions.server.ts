// Server-only: analyze drift between prime and a single clone, then ask
// Lovable AI for actionable fix suggestions. Persists to clones.drift_suggestions.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  getAppOctokit,
  listFilesMatchingGlobs,
  getFileContent,
  type RepoRef,
} from "./github-app.server";

type SupabaseLike = SupabaseClient<Database>;
type CascadeMode = Database["public"]["Enums"]["cascade_mode"];

export type DriftSuggestion = {
  id: string;
  created_at: string;
  source_sha: string;
  files: string[];
  risk: "low" | "medium" | "high";
  category: string;
  summary: string;
  rationale: string;
  recommended_mode: CascadeMode;
  status: "open" | "applied" | "dismissed";
  applied_event_id?: string | null;
};

export type AnalyzeDriftResult =
  | { ok: true; clone_id: string; suggestions: DriftSuggestion[]; analyzed_files: number }
  | { ok: false; error: string };

const MAX_FILES_TO_DIFF = 12;
const MAX_DIFF_CHARS_PER_FILE = 2400;

function uuid(): string {
  // Crypto.randomUUID is available in the Worker runtime.
  return crypto.randomUUID();
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + `\n…(+${s.length - n} chars truncated)` : s;
}

export async function analyzeCloneDrift(
  supabase: SupabaseLike,
  cloneId: string,
): Promise<AnalyzeDriftResult> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return { ok: false, error: "LOVABLE_API_KEY not configured" };

  const [cloneRes, primeRes, modulesRes] = await Promise.all([
    supabase.from("clones").select("*").eq("id", cloneId).maybeSingle(),
    supabase.from("prime_config").select("*").limit(1).maybeSingle(),
    supabase
      .from("clone_modules")
      .select("modules(name, file_globs)")
      .eq("clone_id", cloneId),
  ]);
  const clone = cloneRes.data;
  const prime = primeRes.data;
  if (!clone) return { ok: false, error: "Clone not found" };
  if (!prime) return { ok: false, error: "Prime not configured" };

  const installedGlobs: string[] = (modulesRes.data ?? []).flatMap(
    (cm: { modules: { file_globs: string[] | null } | null }) =>
      cm.modules?.file_globs ?? [],
  );
  if (installedGlobs.length === 0) {
    return { ok: false, error: "No modules installed — nothing to analyze" };
  }

  let octokit;
  try {
    octokit = getAppOctokit();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "GitHub App not configured" };
  }

  const primeRef: RepoRef = {
    owner: prime.github_owner,
    repo: prime.github_repo,
    branch: prime.default_branch || "main",
  };
  const cloneRef: RepoRef = {
    owner: clone.github_owner,
    repo: clone.github_repo,
    branch: clone.default_branch || "main",
  };

  let primeSha: string;
  try {
    const { data: br } = await octokit.repos.getBranch({
      owner: primeRef.owner,
      repo: primeRef.repo,
      branch: primeRef.branch,
    });
    primeSha = br.commit.sha;
  } catch (e) {
    return { ok: false, error: `Prime unreachable: ${e instanceof Error ? e.message : "unknown"}` };
  }

  const primeFiles = await listFilesMatchingGlobs(octokit, primeRef, installedGlobs);
  if (primeFiles.length === 0) {
    return { ok: true, clone_id: cloneId, suggestions: [], analyzed_files: 0 };
  }

  // Collect drifted files (different content) — bounded for prompt size.
  const drifted: Array<{ path: string; primeContent: string; cloneContent: string | null }> = [];
  for (const path of primeFiles) {
    if (drifted.length >= MAX_FILES_TO_DIFF) break;
    const [pf, cf] = await Promise.all([
      getFileContent(octokit, primeRef, path),
      getFileContent(octokit, cloneRef, path),
    ]);
    if (!pf) continue;
    if (cf && cf.content === pf.content) continue;
    drifted.push({ path, primeContent: pf.content, cloneContent: cf?.content ?? null });
  }

  if (drifted.length === 0) {
    // Persist empty result so UI can show "no drift" timestamp
    await supabase
      .from("clones")
      .update({
        drift_suggestions: [],
        last_drift_check_at: new Date().toISOString(),
      })
      .eq("id", cloneId);
    return { ok: true, clone_id: cloneId, suggestions: [], analyzed_files: 0 };
  }

  const fileSnippets = drifted
    .map(
      (d) =>
        `### ${d.path}\n` +
        `--- prime ---\n${truncate(d.primeContent, MAX_DIFF_CHARS_PER_FILE)}\n` +
        `--- clone ---\n${truncate(d.cloneContent ?? "(missing on clone)", MAX_DIFF_CHARS_PER_FILE)}`,
    )
    .join("\n\n");

  const systemPrompt =
    `You are a senior platform engineer reviewing drift between a "prime" template repo ` +
    `and a "clone" repo. The clone has installed specific modules and should stay in sync ` +
    `with the prime version of those module files. Group related file changes into actionable ` +
    `suggestions. For each suggestion: assess RISK (low/medium/high), pick a CATEGORY ` +
    `(e.g. "config", "ui", "security", "deps", "infra", "docs"), write a concise SUMMARY ` +
    `(<= 80 chars), a longer RATIONALE explaining what changed and why it matters, and a ` +
    `RECOMMENDED_MODE: "auto_merge" for safe identical-purpose updates, "pr" for anything ` +
    `requiring review, "notify" for changes that may need human judgment before applying.`;

  const userPrompt =
    `Clone: ${clone.name} (${clone.github_owner}/${clone.github_repo})\n` +
    `Prime: ${prime.github_owner}/${prime.github_repo}@${primeSha.slice(0, 7)}\n` +
    `Drifted files (${drifted.length} of ${primeFiles.length} in scope):\n\n${fileSnippets}`;

  const tool = {
    type: "function" as const,
    function: {
      name: "emit_suggestions",
      description: "Return grouped, actionable drift fix suggestions.",
      parameters: {
        type: "object",
        properties: {
          suggestions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                files: { type: "array", items: { type: "string" } },
                risk: { type: "string", enum: ["low", "medium", "high"] },
                category: { type: "string" },
                summary: { type: "string" },
                rationale: { type: "string" },
                recommended_mode: {
                  type: "string",
                  enum: ["pr", "auto_merge", "notify"],
                },
              },
              required: ["files", "risk", "category", "summary", "rationale", "recommended_mode"],
              additionalProperties: false,
            },
          },
        },
        required: ["suggestions"],
        additionalProperties: false,
      },
    },
  };

  const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      tools: [tool],
      tool_choice: { type: "function", function: { name: "emit_suggestions" } },
    }),
  });

  if (!aiRes.ok) {
    if (aiRes.status === 429) {
      return { ok: false, error: "AI rate limit reached — try again in a minute." };
    }
    if (aiRes.status === 402) {
      return {
        ok: false,
        error: "Lovable AI credits exhausted — top up under Settings → Workspace → Usage.",
      };
    }
    const txt = await aiRes.text();
    return { ok: false, error: `AI error ${aiRes.status}: ${txt.slice(0, 200)}` };
  }

  const aiData = (await aiRes.json()) as {
    choices?: Array<{
      message?: { tool_calls?: Array<{ function?: { arguments?: string } }> };
    }>;
  };
  const argStr = aiData.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!argStr) return { ok: false, error: "AI returned no suggestions" };

  let parsed: { suggestions?: Array<Omit<DriftSuggestion, "id" | "created_at" | "source_sha" | "status">> };
  try {
    parsed = JSON.parse(argStr);
  } catch {
    return { ok: false, error: "AI returned malformed suggestions" };
  }

  const now = new Date().toISOString();
  const suggestions: DriftSuggestion[] = (parsed.suggestions ?? []).map((s) => ({
    id: uuid(),
    created_at: now,
    source_sha: primeSha,
    files: Array.isArray(s.files) ? s.files.slice(0, 50) : [],
    risk: s.risk ?? "medium",
    category: s.category ?? "general",
    summary: s.summary ?? "Drift detected",
    rationale: s.rationale ?? "",
    recommended_mode: s.recommended_mode ?? "pr",
    status: "open",
    applied_event_id: null,
  }));

  // Persist atop the clone, preserving any earlier non-open entries
  // (applied/dismissed) for traceability.
  const existing = (clone.drift_suggestions as unknown as DriftSuggestion[] | null) ?? [];
  const closed = existing.filter((s) => s.status !== "open");
  const merged = [...suggestions, ...closed];

  await supabase
    .from("clones")
    .update({
      drift_suggestions: merged as unknown as Database["public"]["Tables"]["clones"]["Update"]["drift_suggestions"],
      last_drift_check_at: now,
    })
    .eq("id", cloneId);

  await supabase.from("audit_log").insert({
    action: "drift.analyzed",
    entity_type: "clone",
    entity_id: cloneId,
    metadata: {
      analyzed_files: drifted.length,
      suggestions: suggestions.length,
      source_sha: primeSha,
    },
  });

  return { ok: true, clone_id: cloneId, suggestions, analyzed_files: drifted.length };
}
