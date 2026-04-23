// Server-only core for the enhanced multi-pass AI module detection engine.
// Phase 1: Real GitHub tree fetch + content sampling + package.json analysis
// Phase 2: Import graph extraction + cluster detection
// Phase 3: Multi-pass AI refinement loop
// Phase 4: Incremental delta detection + drift alerts
// Phase 6: Cross-clone intelligence (co-installation, health scoring)

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getAppOctokit, type RepoRef } from "./github-app.server";
import type { Octokit } from "@octokit/rest";
import crypto from "crypto";

type Supabase = SupabaseClient<Database>;
type Json = Database["public"]["Tables"]["modules"]["Row"];

export type DetectionStrategy = "feature-first" | "layer-first" | "hybrid";

export type DetectionRunConfig = {
  strategy: DetectionStrategy;
  maxModules: number;
  minModules: number;
  sampleFileContent: boolean;
  analyzeImports: boolean;
  deltaMode: boolean;
};

export const DEFAULT_CONFIG: DetectionRunConfig = {
  strategy: "hybrid",
  maxModules: 12,
  minModules: 3,
  sampleFileContent: true,
  analyzeImports: true,
  deltaMode: false,
};

type ProposedModule = {
  name: string;
  slug: string;
  description: string;
  file_globs: string[];
  routes: string[];
  ai_confidence: number;
  ai_reasoning: string;
  cohesion_score: number;
  coupling_score: number;
  requires: string[];
  incompatible_with: string[];
};

type PassResult = {
  pass: number;
  name: string;
  model: string;
  duration_ms: number;
  modules_proposed: number;
  summary: string;
};

export type DetectionProgress = {
  runId: string;
  phase: string;
  detail: string;
  percent: number;
};

type ImportEdge = {
  source_file: string;
  target_file: string;
  import_type: "static" | "dynamic" | "re-export";
};

// ─── Phase 1: Real GitHub Tree Fetch ────────────────────────────────

async function fetchRepoTree(
  octokit: Octokit,
  ref: RepoRef,
): Promise<{ files: string[]; treeHash: string }> {
  const { data: branch } = await octokit.repos.getBranch({
    owner: ref.owner,
    repo: ref.repo,
    branch: ref.branch,
  });
  const treeSha = branch.commit.commit.tree.sha;
  const { data: tree } = await octokit.git.getTree({
    owner: ref.owner,
    repo: ref.repo,
    tree_sha: treeSha,
    recursive: "true",
  });

  const files = (tree.tree ?? [])
    .filter((n) => n.type === "blob" && typeof n.path === "string")
    .map((n) => n.path as string)
    .filter((p) => !p.startsWith(".") && !p.includes("node_modules/"));

  // Hash the sorted file list for change detection
  const treeHash = crypto
    .createHash("sha256")
    .update(files.sort().join("\n"))
    .digest("hex")
    .slice(0, 16);

  return { files, treeHash };
}

// Sample content from key files for richer AI context
async function sampleFileContents(
  octokit: Octokit,
  ref: RepoRef,
  files: string[],
  maxSamples: number = 30,
): Promise<Map<string, string>> {
  const samples = new Map<string, string>();

  // Priority: package.json, route files, config files, then by extension diversity
  const priorityPatterns = [
    /^package\.json$/,
    /routes?\//,
    /\.config\./,
    /supabase\/functions\//,
    /^src\/lib\//,
    /^src\/components\//,
  ];

  const scored = files
    .filter((f) => /\.(ts|tsx|js|jsx|json)$/.test(f))
    .map((f) => {
      let score = 0;
      for (let i = 0; i < priorityPatterns.length; i++) {
        if (priorityPatterns[i].test(f)) {
          score = priorityPatterns.length - i;
          break;
        }
      }
      return { file: f, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSamples);

  // Fetch in parallel batches of 5
  for (let i = 0; i < scored.length; i += 5) {
    const batch = scored.slice(i, i + 5);
    const results = await Promise.allSettled(
      batch.map(async ({ file }) => {
        try {
          const res = await octokit.repos.getContent({
            owner: ref.owner,
            repo: ref.repo,
            path: file,
            ref: ref.branch,
          });
          const data = res.data as { type?: string; content?: string; size?: number };
          if (data.type !== "file" || !data.content) return null;
          // Limit to ~4KB per file for token efficiency
          const content = Buffer.from(data.content, "base64")
            .toString("utf8")
            .slice(0, 4096);
          return { file, content };
        } catch {
          return null;
        }
      }),
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) {
        samples.set(r.value.file, r.value.content);
      }
    }
  }

  return samples;
}

// ─── Phase 2: Import Graph Analysis ─────────────────────────────────

function extractImports(filePath: string, content: string): ImportEdge[] {
  const edges: ImportEdge[] = [];
  const dir = filePath.includes("/") ? filePath.substring(0, filePath.lastIndexOf("/")) : "";

  // Static imports: import ... from '...'
  const staticRx = /import\s+(?:[\w{}\s,*]+\s+from\s+)?['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = staticRx.exec(content)) !== null) {
    const target = resolveImportPath(dir, m[1]);
    if (target) {
      edges.push({ source_file: filePath, target_file: target, import_type: "static" });
    }
  }

  // Dynamic imports: import('...')
  const dynamicRx = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = dynamicRx.exec(content)) !== null) {
    const target = resolveImportPath(dir, m[1]);
    if (target) {
      edges.push({ source_file: filePath, target_file: target, import_type: "dynamic" });
    }
  }

  // Re-exports: export ... from '...'
  const reExportRx = /export\s+(?:[\w{}\s,*]+\s+)?from\s+['"]([^'"]+)['"]/g;
  while ((m = reExportRx.exec(content)) !== null) {
    const target = resolveImportPath(dir, m[1]);
    if (target) {
      edges.push({ source_file: filePath, target_file: target, import_type: "re-export" });
    }
  }

  return edges;
}

function resolveImportPath(dir: string, specifier: string): string | null {
  // Skip node_modules / bare specifiers
  if (!specifier.startsWith(".") && !specifier.startsWith("@/") && !specifier.startsWith("~/")) {
    return null;
  }
  // Resolve @/ alias
  if (specifier.startsWith("@/") || specifier.startsWith("~/")) {
    return "src/" + specifier.slice(2);
  }
  // Relative resolution
  const parts = dir.split("/").filter(Boolean);
  for (const seg of specifier.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

function buildImportGraph(
  fileContents: Map<string, string>,
): { edges: ImportEdge[]; clusters: Map<string, Set<string>> } {
  const edges: ImportEdge[] = [];
  for (const [path, content] of fileContents) {
    edges.push(...extractImports(path, content));
  }

  // Simple cluster detection: files that import each other belong together
  const adjacency = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!adjacency.has(e.source_file)) adjacency.set(e.source_file, new Set());
    adjacency.get(e.source_file)!.add(e.target_file);
  }

  // Connected components via BFS
  const visited = new Set<string>();
  const clusters = new Map<string, Set<string>>();
  let clusterIdx = 0;

  for (const node of adjacency.keys()) {
    if (visited.has(node)) continue;
    const cluster = new Set<string>();
    const queue = [node];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      cluster.add(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!visited.has(neighbor)) queue.push(neighbor);
      }
    }
    clusters.set(`cluster-${clusterIdx++}`, cluster);
  }

  return { edges, clusters };
}

// Calculate cohesion (internal imports / total imports for files in module)
function calculateCohesion(
  moduleFiles: string[],
  edges: ImportEdge[],
): { cohesion: number; coupling: number } {
  const fileSet = new Set(moduleFiles);
  let internal = 0;
  let external = 0;

  for (const e of edges) {
    if (!fileSet.has(e.source_file)) continue;
    if (fileSet.has(e.target_file)) internal++;
    else external++;
  }

  const total = internal + external;
  return {
    cohesion: total === 0 ? 1 : internal / total,
    coupling: total === 0 ? 0 : external / total,
  };
}

// ─── Phase 3: Multi-Pass AI Detection ───────────────────────────────

const AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

async function aiCall(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  tools?: unknown[],
  toolChoice?: unknown,
): Promise<unknown> {
  const body: Record<string, unknown> = {
    model,
    reasoning: { effort: "high" },
    messages,
  };
  if (tools) body.tools = tools;
  if (toolChoice) body.tool_choice = toolChoice;

  const res = await fetch(AI_GATEWAY, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text();
    if (res.status === 429) throw new Error("Rate limited — try again shortly.");
    if (res.status === 402) throw new Error("AI credits exhausted.");
    throw new Error(`AI error ${res.status}: ${t.slice(0, 200)}`);
  }

  return res.json();
}

function buildModuleProposalTools() {
  return [
    {
      type: "function",
      function: {
        name: "propose_modules",
        description: "Return a list of proposed modules with reasoning and scores.",
        parameters: {
          type: "object",
          properties: {
            modules: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  slug: { type: "string", description: "kebab-case unique identifier" },
                  description: { type: "string" },
                  file_globs: { type: "array", items: { type: "string" } },
                  routes: { type: "array", items: { type: "string" } },
                  ai_confidence: { type: "number", minimum: 0, maximum: 1 },
                  ai_reasoning: { type: "string", description: "Why these files form a cohesive module" },
                  cohesion_score: { type: "number", minimum: 0, maximum: 1, description: "Internal cohesion" },
                  coupling_score: { type: "number", minimum: 0, maximum: 1, description: "External coupling" },
                  requires: { type: "array", items: { type: "string" }, description: "Module slugs this depends on" },
                  incompatible_with: { type: "array", items: { type: "string" }, description: "Module slugs that conflict" },
                },
                required: ["name", "slug", "description", "file_globs", "routes", "ai_confidence", "ai_reasoning", "cohesion_score", "coupling_score", "requires", "incompatible_with"],
                additionalProperties: false,
              },
            },
          },
          required: ["modules"],
          additionalProperties: false,
        },
      },
    },
  ];
}

function buildRefinementTools() {
  return [
    {
      type: "function",
      function: {
        name: "refine_modules",
        description: "Validate and refine module boundaries, resolving overlaps.",
        parameters: {
          type: "object",
          properties: {
            modules: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  slug: { type: "string" },
                  description: { type: "string" },
                  file_globs: { type: "array", items: { type: "string" } },
                  routes: { type: "array", items: { type: "string" } },
                  ai_confidence: { type: "number" },
                  ai_reasoning: { type: "string" },
                  cohesion_score: { type: "number" },
                  coupling_score: { type: "number" },
                  requires: { type: "array", items: { type: "string" } },
                  incompatible_with: { type: "array", items: { type: "string" } },
                  action: { type: "string", enum: ["keep", "merge", "split", "drop"], description: "What to do with this module" },
                  merge_into: { type: "string", description: "If action=merge, the slug to merge into" },
                },
                required: ["name", "slug", "description", "file_globs", "routes", "ai_confidence", "ai_reasoning", "cohesion_score", "coupling_score", "requires", "incompatible_with", "action"],
                additionalProperties: false,
              },
            },
            orphan_files: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  file_path: { type: "string" },
                  suggested_module_slug: { type: "string" },
                  reasoning: { type: "string" },
                },
                required: ["file_path", "suggested_module_slug", "reasoning"],
                additionalProperties: false,
              },
            },
          },
          required: ["modules", "orphan_files"],
          additionalProperties: false,
        },
      },
    },
  ];
}

function getStrategyPrompt(strategy: DetectionStrategy): string {
  switch (strategy) {
    case "feature-first":
      return `Group by USER-FACING FEATURES. Each module is a distinct product capability (auth, billing, blog, admin panel, etc.). Prefer vertical slices (route + components + logic + API) over horizontal layers.`;
    case "layer-first":
      return `Group by ARCHITECTURAL LAYERS. Each module is a technical concern (UI components, data layer, auth infrastructure, API routes, etc.). Prefer horizontal slices that can be composed independently.`;
    case "hybrid":
    default:
      return `Use a HYBRID approach: start by identifying user-facing features as primary modules, but break out shared infrastructure (auth, data layer, UI kit) as separate utility modules when they're used across 3+ feature modules.`;
  }
}

// Pass 1: Coarse detection from tree + content + deps
async function runPass1(args: {
  apiKey: string;
  owner: string;
  repo: string;
  branch: string;
  files: string[];
  samples: Map<string, string>;
  importEdges: ImportEdge[];
  strategy: DetectionStrategy;
  maxModules: number;
  minModules: number;
}): Promise<{ modules: ProposedModule[]; pass: PassResult }> {
  const start = Date.now();

  // Build dependency context
  let depContext = "";
  const pkgContent = args.samples.get("package.json");
  if (pkgContent) {
    try {
      const pkg = JSON.parse(pkgContent);
      const deps = Object.keys(pkg.dependencies ?? {}).join(", ");
      const devDeps = Object.keys(pkg.devDependencies ?? {}).join(", ");
      depContext = `\n\nDependencies: ${deps}\nDevDependencies: ${devDeps}`;
    } catch { /* ignore */ }
  }

  // Build import graph summary for AI
  let importSummary = "";
  if (args.importEdges.length > 0) {
    const fileImportCount = new Map<string, number>();
    for (const e of args.importEdges) {
      fileImportCount.set(e.source_file, (fileImportCount.get(e.source_file) ?? 0) + 1);
    }
    const topImporters = [...fileImportCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([f, n]) => `  ${f} → ${n} imports`)
      .join("\n");
    importSummary = `\n\nImport graph (top 20 files by import count):\n${topImporters}\n\nTotal import edges: ${args.importEdges.length}`;
  }

  // Build file content samples for AI
  let sampleContext = "";
  const routeSamples = [...args.samples.entries()]
    .filter(([f]) => f.includes("routes/"))
    .slice(0, 10);
  if (routeSamples.length > 0) {
    sampleContext = "\n\nRoute file samples:\n" + routeSamples
      .map(([f, c]) => `--- ${f} ---\n${c.slice(0, 1500)}`)
      .join("\n\n");
  }

  const systemPrompt = `You are a senior software architect specializing in modular monorepo decomposition.
Given the REAL file tree, dependency graph, and code samples of a TanStack Start + Supabase project, identify cohesive MODULES.

${getStrategyPrompt(args.strategy)}

A module is:
- A bounded, independently injectable feature or infrastructure slice
- Defined by file_globs (glob patterns covering its files) and routes (URL paths)
- Has clear cohesion (files inside reference each other) and low coupling (minimal cross-module deps)
- ai_reasoning must explain WHY these files form a cohesive unit

Scoring:
- cohesion_score: 0-1, how tightly coupled the internal files are
- coupling_score: 0-1, how much this module depends on other modules (lower is better)
- ai_confidence: 0-1, overall confidence in this boundary

Return ONLY via the propose_modules tool call. No prose.`;

  const userPrompt = `Prime repo: ${args.owner}/${args.repo} (branch: ${args.branch})

File tree (${args.files.length} files):
${args.files.map((f) => `- ${f}`).join("\n")}
${depContext}${importSummary}${sampleContext}

Propose ${args.minModules}-${args.maxModules} modules. Be thorough in your reasoning.`;

  const json = await aiCall(
    args.apiKey,
    "google/gemini-2.5-pro",
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    buildModuleProposalTools(),
    { type: "function", function: { name: "propose_modules" } },
  ) as { choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }> };

  const toolCall = json.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall?.function?.arguments) throw new Error("Pass 1: Model returned no tool call");

  const parsed = JSON.parse(toolCall.function.arguments) as { modules: ProposedModule[] };
  const duration = Date.now() - start;

  return {
    modules: parsed.modules ?? [],
    pass: {
      pass: 1,
      name: "Coarse detection",
      model: "google/gemini-2.5-pro",
      duration_ms: duration,
      modules_proposed: (parsed.modules ?? []).length,
      summary: `Proposed ${(parsed.modules ?? []).length} modules from ${args.files.length} files`,
    },
  };
}

// Pass 2: Validation & refinement with import graph data
async function runPass2(args: {
  apiKey: string;
  pass1Modules: ProposedModule[];
  files: string[];
  importEdges: ImportEdge[];
  strategy: DetectionStrategy;
}): Promise<{ modules: ProposedModule[]; orphanFiles: Array<{ file_path: string; suggested_module_slug: string; reasoning: string }>; pass: PassResult }> {
  const start = Date.now();

  // Calculate actual cohesion/coupling from import graph
  const enrichedModules = args.pass1Modules.map((m) => {
    const moduleFiles = args.files.filter((f) =>
      m.file_globs.some((g) => {
        try { return new RegExp(globToRegex(g)).test(f); } catch { return false; }
      }),
    );
    const { cohesion, coupling } = calculateCohesion(moduleFiles, args.importEdges);
    return { ...m, real_cohesion: cohesion, real_coupling: coupling, matched_files: moduleFiles.length };
  });

  // Find files not covered by any module
  const coveredFiles = new Set<string>();
  for (const m of enrichedModules) {
    const moduleFiles = args.files.filter((f) =>
      m.file_globs.some((g) => {
        try { return new RegExp(globToRegex(g)).test(f); } catch { return false; }
      }),
    );
    for (const f of moduleFiles) coveredFiles.add(f);
  }
  const orphanCandidates = args.files
    .filter((f) => !coveredFiles.has(f))
    .filter((f) => /\.(ts|tsx|js|jsx)$/.test(f))
    .slice(0, 50);

  // Check for file overlaps between modules
  const fileModuleMap = new Map<string, string[]>();
  for (const m of enrichedModules) {
    const moduleFiles = args.files.filter((f) =>
      m.file_globs.some((g) => {
        try { return new RegExp(globToRegex(g)).test(f); } catch { return false; }
      }),
    );
    for (const f of moduleFiles) {
      if (!fileModuleMap.has(f)) fileModuleMap.set(f, []);
      fileModuleMap.get(f)!.push(m.slug);
    }
  }
  const overlaps = [...fileModuleMap.entries()]
    .filter(([, mods]) => mods.length > 1)
    .slice(0, 20)
    .map(([f, mods]) => `  ${f} → [${mods.join(", ")}]`);

  const systemPrompt = `You are reviewing a FIRST-PASS module decomposition and must REFINE it.

${getStrategyPrompt(args.strategy)}

For each module, you'll see the AI-proposed boundaries plus REAL import graph metrics.
Your job:
1. Validate or correct cohesion/coupling scores using the real metrics provided
2. Merge modules that are too granular (< 3 files or always co-imported)
3. Split modules that are too broad (> 50 files or low cohesion)
4. Resolve file overlaps (files claimed by multiple modules)
5. Assign orphan files to the most appropriate module
6. Set action: "keep", "merge" (with merge_into), "split", or "drop"

Return via the refine_modules tool call.`;

  const userPrompt = `Pass 1 proposed ${enrichedModules.length} modules:

${enrichedModules.map((m) => `### ${m.name} (${m.slug})
  AI cohesion: ${m.cohesion_score} | Real cohesion: ${m.real_cohesion.toFixed(2)} | AI coupling: ${m.coupling_score} | Real coupling: ${m.real_coupling.toFixed(2)}
  Matched files: ${m.matched_files} | Globs: ${m.file_globs.join(", ")}
  Routes: ${m.routes.join(", ")}
  Reasoning: ${m.ai_reasoning}`).join("\n\n")}

${overlaps.length > 0 ? `\nFile overlaps (${overlaps.length}):\n${overlaps.join("\n")}` : ""}

${orphanCandidates.length > 0 ? `\nOrphan files (${orphanCandidates.length}):\n${orphanCandidates.map((f) => `  - ${f}`).join("\n")}` : ""}

Total import edges: ${args.importEdges.length}`;

  const json = await aiCall(
    args.apiKey,
    "google/gemini-3-flash-preview",
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    buildRefinementTools(),
    { type: "function", function: { name: "refine_modules" } },
  ) as { choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }> };

  const toolCall = json.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall?.function?.arguments) throw new Error("Pass 2: Model returned no tool call");

  const parsed = JSON.parse(toolCall.function.arguments) as {
    modules: (ProposedModule & { action: string; merge_into?: string })[];
    orphan_files: Array<{ file_path: string; suggested_module_slug: string; reasoning: string }>;
  };

  // Apply merge/drop/keep actions
  const mergeTargets = new Map<string, string>();
  for (const m of parsed.modules) {
    if (m.action === "merge" && m.merge_into) mergeTargets.set(m.slug, m.merge_into);
  }

  const finalModules = parsed.modules
    .filter((m) => m.action === "keep" || m.action === "split")
    .map((m) => ({
      name: m.name,
      slug: m.slug,
      description: m.description,
      file_globs: m.file_globs,
      routes: m.routes,
      ai_confidence: m.ai_confidence,
      ai_reasoning: m.ai_reasoning,
      cohesion_score: m.cohesion_score,
      coupling_score: m.coupling_score,
      requires: m.requires ?? [],
      incompatible_with: m.incompatible_with ?? [],
    }));

  const duration = Date.now() - start;

  return {
    modules: finalModules,
    orphanFiles: parsed.orphan_files ?? [],
    pass: {
      pass: 2,
      name: "Refinement & conflict resolution",
      model: "google/gemini-3-flash-preview",
      duration_ms: duration,
      modules_proposed: finalModules.length,
      summary: `Refined to ${finalModules.length} modules, found ${(parsed.orphan_files ?? []).length} orphan assignments`,
    },
  };
}

function globToRegex(glob: string): string {
  let out = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      out += ".*";
      i++;
      if (glob[i + 1] === "/") i++;
    } else if (c === "*") {
      out += "[^/]*";
    } else if (c === "?") {
      out += "[^/]";
    } else if (".+^${}()|[]\\".includes(c)) {
      out += "\\" + c;
    } else {
      out += c;
    }
  }
  out += "$";
  return out;
}

// ─── Main Detection Orchestrator ────────────────────────────────────

export async function runDetection(args: {
  supabase: Supabase;
  userId: string;
  config: DetectionRunConfig;
  onProgress?: (p: DetectionProgress) => void;
}): Promise<{
  ok: boolean;
  runId: string;
  proposed: number;
  inserted: number;
  updated: number;
  orphanAlerts: number;
  error?: string;
}> {
  const { supabase, userId, config, onProgress } = args;
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return { ok: false, runId: "", proposed: 0, inserted: 0, updated: 0, orphanAlerts: 0, error: "LOVABLE_API_KEY not configured" };

  // Get prime config
  const { data: prime } = await supabase.from("prime_config").select("*").limit(1).maybeSingle();
  if (!prime) return { ok: false, runId: "", proposed: 0, inserted: 0, updated: 0, orphanAlerts: 0, error: "Configure prime repo first" };

  // Find previous run for delta mode
  let previousRunId: string | null = null;
  let previousTreeHash: string | null = null;
  if (config.deltaMode) {
    const { data: prev } = await supabase
      .from("module_detection_runs")
      .select("id, tree_hash")
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (prev) {
      previousRunId = prev.id;
      previousTreeHash = prev.tree_hash;
    }
  }

  // Create the detection run record
  const { data: run, error: runErr } = await supabase
    .from("module_detection_runs")
    .insert({
      strategy: config.strategy,
      status: "running",
      delta_mode: config.deltaMode,
      previous_run_id: previousRunId,
      initiated_by: userId,
      started_at: new Date().toISOString(),
      parameters: JSON.parse(JSON.stringify(config)),
    })
    .select()
    .single();
  if (runErr || !run) {
    return { ok: false, runId: "", proposed: 0, inserted: 0, updated: 0, orphanAlerts: 0, error: runErr?.message ?? "Failed to create run" };
  }

  const runId = run.id;
  const progress = (phase: string, detail: string, percent: number) => {
    onProgress?.({ runId, phase, detail, percent });
  };

  try {
    // ── Phase 1: Fetch real tree ──
    progress("tree_fetch", "Fetching repository tree from GitHub…", 5);
    const octokit = getAppOctokit();
    const ref: RepoRef = { owner: prime.github_owner, repo: prime.github_repo, branch: prime.default_branch };
    const { files, treeHash } = await fetchRepoTree(octokit, ref);

    // Delta check: if tree hasn't changed and we're in delta mode, skip
    if (config.deltaMode && previousTreeHash === treeHash) {
      await supabase.from("module_detection_runs").update({
        status: "completed",
        tree_hash: treeHash,
        file_count: files.length,
        completed_at: new Date().toISOString(),
        error_message: "No changes detected since last scan",
      }).eq("id", runId);
      return { ok: true, runId, proposed: 0, inserted: 0, updated: 0, orphanAlerts: 0, error: "No changes since last scan" };
    }

    progress("tree_fetch", `Found ${files.length} files`, 15);

    // ── Phase 1b: Sample file contents ──
    let samples = new Map<string, string>();
    if (config.sampleFileContent) {
      progress("content_sampling", "Sampling file contents for AI context…", 20);
      samples = await sampleFileContents(octokit, ref, files, 30);
      progress("content_sampling", `Sampled ${samples.size} files`, 30);
    }

    // ── Phase 2: Import graph ──
    let importEdges: ImportEdge[] = [];
    if (config.analyzeImports && samples.size > 0) {
      progress("import_analysis", "Building import dependency graph…", 35);
      const graph = buildImportGraph(samples);
      importEdges = graph.edges;
      progress("import_analysis", `Found ${importEdges.length} import edges in ${graph.clusters.size} clusters`, 40);

      // Store import edges
      if (importEdges.length > 0) {
        const edgeRows = importEdges.slice(0, 500).map((e) => ({
          detection_run_id: runId,
          source_file: e.source_file,
          target_file: e.target_file,
          import_type: e.import_type,
        }));
        await supabase.from("module_import_edges").insert(edgeRows);
      }
    }

    // ── Phase 3: Pass 1 — Coarse detection ──
    progress("ai_pass_1", "Running AI Pass 1: coarse module detection…", 45);
    const pass1 = await runPass1({
      apiKey,
      owner: prime.github_owner,
      repo: prime.github_repo,
      branch: prime.default_branch,
      files,
      samples,
      importEdges,
      strategy: config.strategy,
      maxModules: config.maxModules,
      minModules: config.minModules,
    });
    progress("ai_pass_1", `Pass 1 proposed ${pass1.modules.length} modules`, 60);

    // ── Phase 3: Pass 2 — Refinement ──
    progress("ai_pass_2", "Running AI Pass 2: refinement & conflict resolution…", 65);
    const pass2 = await runPass2({
      apiKey,
      pass1Modules: pass1.modules,
      files,
      importEdges,
      strategy: config.strategy,
    });
    progress("ai_pass_2", `Refined to ${pass2.modules.length} modules`, 80);

    const passes: PassResult[] = [pass1.pass, pass2.pass];
    const finalModules = pass2.modules;

    // ── Persist modules ──
    progress("persisting", "Saving detection results…", 85);
    let inserted = 0;
    let updated = 0;

    for (const m of finalModules) {
      const { data: existing } = await supabase
        .from("modules")
        .select("id, status")
        .eq("slug", m.slug)
        .maybeSingle();

      if (existing) {
        // Update if still proposed (don't clobber approved/archived)
        if (existing.status === "proposed") {
          await supabase.from("modules").update({
            name: m.name,
            description: m.description,
            file_globs: m.file_globs,
            routes: m.routes,
            ai_confidence: m.ai_confidence,
            ai_reasoning: m.ai_reasoning,
            cohesion_score: m.cohesion_score,
            coupling_score: m.coupling_score,
            requires: m.requires,
            incompatible_with: m.incompatible_with,
            detection_run_id: runId,
            tree_snapshot_hash: treeHash,
          }).eq("id", existing.id);
          updated++;
        }
      } else {
        const { error } = await supabase.from("modules").insert({
          name: m.name,
          slug: m.slug,
          description: m.description,
          file_globs: m.file_globs,
          routes: m.routes,
          ai_confidence: m.ai_confidence,
          ai_reasoning: m.ai_reasoning,
          cohesion_score: m.cohesion_score,
          coupling_score: m.coupling_score,
          requires: m.requires,
          incompatible_with: m.incompatible_with,
          status: "proposed",
          detected_by_ai: true,
          detection_run_id: runId,
          tree_snapshot_hash: treeHash,
        });
        if (!error) inserted++;
      }
    }

    // ── Phase 4: Drift alerts for orphan files ──
    let orphanAlerts = 0;
    if (pass2.orphanFiles.length > 0) {
      progress("drift_alerts", "Creating drift alerts for orphan files…", 90);
      const alerts = pass2.orphanFiles.map((o) => ({
        detection_run_id: runId,
        alert_type: "orphan_file",
        file_path: o.file_path,
        suggested_module_slug: o.suggested_module_slug,
        reasoning: o.reasoning,
        severity: "info",
      }));
      const { error: alertErr } = await supabase.from("module_drift_alerts").insert(alerts);
      if (!alertErr) orphanAlerts = alerts.length;
    }

    // ── Finalize run record ──
    progress("complete", "Detection complete!", 100);
    await supabase.from("module_detection_runs").update({
      status: "completed",
      tree_hash: treeHash,
      file_count: files.length,
      sampled_file_count: samples.size,
      dependency_count: importEdges.length,
      pass_count: passes.length,
      passes: JSON.parse(JSON.stringify(passes)),
      proposed_modules: finalModules.length,
      inserted_modules: inserted,
      updated_modules: updated,
      orphan_files_found: orphanAlerts,
      completed_at: new Date().toISOString(),
    }).eq("id", runId);

    // Audit log
    await supabase.from("audit_log").insert({
      action: "module.ai_detection_complete",
      entity_type: "module_detection_run",
      entity_id: runId,
      actor_user_id: userId,
      metadata: {
        strategy: config.strategy,
        file_count: files.length,
        proposed: finalModules.length,
        inserted,
        updated,
        orphan_alerts: orphanAlerts,
        passes: passes.length,
      },
    });

    return { ok: true, runId, proposed: finalModules.length, inserted, updated, orphanAlerts };
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    console.error("Detection run failed:", errorMsg);
    await supabase.from("module_detection_runs").update({
      status: "failed",
      error_message: errorMsg,
      completed_at: new Date().toISOString(),
    }).eq("id", runId);
    return { ok: false, runId, proposed: 0, inserted: 0, updated: 0, orphanAlerts: 0, error: errorMsg };
  }
}

// ─── Phase 6: Cross-Clone Intelligence ──────────────────────────────

export async function analyzeModuleIntelligence(supabase: Supabase): Promise<{
  coInstallation: Array<{ module_a: string; module_b: string; coInstallRate: number }>;
  healthScores: Array<{ moduleId: string; moduleName: string; score: number; breakdown: Record<string, number> }>;
}> {
  // Co-installation analysis
  const { data: cloneModules } = await supabase
    .from("clone_modules")
    .select("clone_id, module_id, modules(name, slug)");

  const byClone = new Map<string, string[]>();
  const moduleNames = new Map<string, string>();
  for (const row of (cloneModules ?? []) as Array<{ clone_id: string; module_id: string; modules: { name: string; slug: string } | null }>) {
    if (!row.modules) continue;
    const list = byClone.get(row.clone_id) ?? [];
    list.push(row.module_id);
    byClone.set(row.clone_id, list);
    moduleNames.set(row.module_id, row.modules.name);
  }

  const pairCounts = new Map<string, number>();
  const moduleCounts = new Map<string, number>();
  for (const mods of byClone.values()) {
    for (const m of mods) {
      moduleCounts.set(m, (moduleCounts.get(m) ?? 0) + 1);
    }
    for (let i = 0; i < mods.length; i++) {
      for (let j = i + 1; j < mods.length; j++) {
        const key = [mods[i], mods[j]].sort().join(":");
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }

  const totalClones = byClone.size;
  const coInstallation = [...pairCounts.entries()]
    .map(([key, count]) => {
      const [a, b] = key.split(":");
      return {
        module_a: moduleNames.get(a) ?? a,
        module_b: moduleNames.get(b) ?? b,
        coInstallRate: totalClones > 0 ? count / totalClones : 0,
      };
    })
    .filter((p) => p.coInstallRate > 0.3)
    .sort((a, b) => b.coInstallRate - a.coInstallRate)
    .slice(0, 20);

  // Health scoring
  const { data: modules } = await supabase.from("modules").select("id, name, slug, ai_confidence, cohesion_score, coupling_score");
  const { data: clones } = await supabase.from("clones").select("id, sync_status");

  const cloneStatusMap = new Map<string, string>();
  for (const c of clones ?? []) cloneStatusMap.set(c.id, c.sync_status);

  const healthScores = (modules ?? []).map((m) => {
    const moduleClones = (cloneModules ?? [])
      .filter((cm: { module_id: string }) => cm.module_id === m.id)
      .map((cm: { clone_id: string }) => cm.clone_id);

    const inSync = moduleClones.filter((cid: string) => cloneStatusMap.get(cid) === "in_sync").length;
    const behind = moduleClones.filter((cid: string) => cloneStatusMap.get(cid) === "behind").length;
    const failed = moduleClones.filter((cid: string) => cloneStatusMap.get(cid) === "failed").length;

    const syncRate = moduleClones.length > 0 ? inSync / moduleClones.length : 0;
    const failRate = moduleClones.length > 0 ? failed / moduleClones.length : 0;
    const cohesion = Number(m.cohesion_score) || 0.5;
    const coupling = Number(m.coupling_score) || 0.5;
    const confidence = Number(m.ai_confidence) || 0.5;
    const coverage = totalClones > 0 ? moduleClones.length / totalClones : 0;

    const score = Math.round(
      (syncRate * 30 + (1 - failRate) * 25 + cohesion * 20 + (1 - coupling) * 15 + confidence * 10) * 100,
    ) / 100;

    return {
      moduleId: m.id,
      moduleName: m.name,
      score,
      breakdown: {
        sync_rate: Math.round(syncRate * 100),
        fail_rate: Math.round(failRate * 100),
        cohesion: Math.round(cohesion * 100),
        coupling: Math.round(coupling * 100),
        confidence: Math.round(confidence * 100),
        coverage: Math.round(coverage * 100),
        clone_count: moduleClones.length,
      },
    };
  }).sort((a, b) => b.score - a.score);

  return { coInstallation, healthScores };
}
