// Route-first module detection engine.
// 1. Fetch real GitHub tree + file contents
// 2. Identify route files (src/routes/*.tsx)
// 3. For each route, recursively trace imports to build the full dependency tree
// 4. Each route = one module. Shared files (used by 2+ routes) = "shared" module.
// 5. Persist results with resolved file lists

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getAppOctokit, type RepoRef } from "./github-app.server";
import type { Octokit } from "@octokit/rest";
import { validateModuleGlobs } from "@/lib/module-globs";
import crypto from "crypto";

type Supabase = SupabaseClient<Database>;

export type DetectionStrategy = "route-first" | "feature-first" | "layer-first" | "hybrid";

export type DetectionRunConfig = {
  strategy: DetectionStrategy;
  maxModules: number;
  minModules: number;
  sampleFileContent: boolean;
  analyzeImports: boolean;
  deltaMode: boolean;
};

export const DEFAULT_CONFIG: DetectionRunConfig = {
  strategy: "route-first",
  maxModules: 30,
  minModules: 1,
  sampleFileContent: true,
  analyzeImports: true,
  deltaMode: false,
};

type ImportEdge = {
  source_file: string;
  target_file: string;
  import_type: "static" | "dynamic" | "re-export";
};

type RouteModule = {
  name: string;
  slug: string;
  description: string;
  route_path: string;
  entry_file: string;
  resolved_files: string[];
  file_globs: string[];
  routes: string[];
  shared_by_modules: string[];
  cohesion_score: number;
  coupling_score: number;
  ai_confidence: number;
  ai_reasoning: string;
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

// ─── GitHub Tree Fetch ──────────────────────────────────────────────

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

  const treeHash = crypto
    .createHash("sha256")
    .update(files.sort().join("\n"))
    .digest("hex")
    .slice(0, 16);

  return { files, treeHash };
}

// Fetch content of specific files
async function fetchFileContents(
  octokit: Octokit,
  ref: RepoRef,
  filePaths: string[],
  maxSize: number = 8192,
): Promise<Map<string, string>> {
  const contents = new Map<string, string>();

  // Batch in groups of 5
  for (let i = 0; i < filePaths.length; i += 5) {
    const batch = filePaths.slice(i, i + 5);
    const results = await Promise.allSettled(
      batch.map(async (file) => {
        try {
          const res = await octokit.repos.getContent({
            owner: ref.owner,
            repo: ref.repo,
            path: file,
            ref: ref.branch,
          });
          const data = res.data as { type?: string; content?: string };
          if (data.type !== "file" || !data.content) return null;
          const content = Buffer.from(data.content, "base64").toString("utf8").slice(0, maxSize);
          return { file, content };
        } catch {
          return null;
        }
      }),
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) {
        contents.set(r.value.file, r.value.content);
      }
    }
  }

  return contents;
}

// ─── Import Resolution ──────────────────────────────────────────────

function resolveImportPath(dir: string, specifier: string): string | null {
  if (!specifier.startsWith(".") && !specifier.startsWith("@/") && !specifier.startsWith("~/")) {
    return null; // npm package
  }
  if (specifier.startsWith("@/") || specifier.startsWith("~/")) {
    return "src/" + specifier.slice(2);
  }
  const parts = dir.split("/").filter(Boolean);
  for (const seg of specifier.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

function extractImports(filePath: string, content: string): string[] {
  const dir = filePath.includes("/") ? filePath.substring(0, filePath.lastIndexOf("/")) : "";
  const imports: string[] = [];

  // Static imports
  const staticRx = /import\s+(?:[\w{}\s,*]+\s+from\s+)?['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = staticRx.exec(content)) !== null) {
    const target = resolveImportPath(dir, m[1]);
    if (target) imports.push(target);
  }

  // Dynamic imports
  const dynamicRx = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = dynamicRx.exec(content)) !== null) {
    const target = resolveImportPath(dir, m[1]);
    if (target) imports.push(target);
  }

  // Re-exports
  const reExportRx = /export\s+(?:[\w{}\s,*]+\s+)?from\s+['"]([^'"]+)['"]/g;
  while ((m = reExportRx.exec(content)) !== null) {
    const target = resolveImportPath(dir, m[1]);
    if (target) imports.push(target);
  }

  return [...new Set(imports)];
}

// Match a resolved import specifier to an actual file in the tree
function findActualFile(specifier: string, allFiles: Set<string>): string | null {
  // Direct match
  if (allFiles.has(specifier)) return specifier;
  // Try extensions
  const exts = [".ts", ".tsx", ".js", ".jsx"];
  for (const ext of exts) {
    if (allFiles.has(specifier + ext)) return specifier + ext;
  }
  // Try index files
  for (const ext of exts) {
    if (allFiles.has(specifier + "/index" + ext)) return specifier + "/index" + ext;
  }
  return null;
}

// Recursively trace all imports from a root file
async function traceImports(
  rootFile: string,
  allFilesSet: Set<string>,
  contentCache: Map<string, string>,
  octokit: Octokit,
  ref: RepoRef,
  maxDepth: number = 20,
): Promise<{ files: string[]; edges: ImportEdge[] }> {
  const visited = new Set<string>();
  const edges: ImportEdge[] = [];
  const queue: Array<{ file: string; depth: number }> = [{ file: rootFile, depth: 0 }];

  while (queue.length > 0) {
    const { file, depth } = queue.shift()!;
    if (visited.has(file) || depth > maxDepth) continue;
    visited.add(file);

    // Get content
    let content = contentCache.get(file);
    if (!content && /\.(ts|tsx|js|jsx)$/.test(file)) {
      const fetched = await fetchFileContents(octokit, ref, [file]);
      content = fetched.get(file);
      if (content) contentCache.set(file, content);
    }
    if (!content) continue;

    const imports = extractImports(file, content);
    for (const imp of imports) {
      const actual = findActualFile(imp, allFilesSet);
      if (actual && !visited.has(actual)) {
        edges.push({ source_file: file, target_file: actual, import_type: "static" });
        queue.push({ file: actual, depth: depth + 1 });
      }
    }
  }

  return { files: [...visited], edges };
}

// ─── Route Detection ────────────────────────────────────────────────

function identifyRouteFiles(files: string[]): string[] {
  return files
    .filter((f) => {
      // Match common route patterns
      if (f.match(/src\/routes\/.*\.(tsx|ts|jsx|js)$/)) return true;
      if (f.match(/app\/routes\/.*\.(tsx|ts|jsx|js)$/)) return true;
      if (f.match(/src\/pages\/.*\.(tsx|ts|jsx|js)$/)) return true;
      return false;
    })
    .filter((f) => {
      // Exclude internal files
      const name = f.split("/").pop() ?? "";
      if (name.startsWith("__root")) return false;
      if (name === "routeTree.gen.ts") return false;
      if (name.startsWith("_")) return false;
      return true;
    });
}

function routeFileToPath(file: string): string {
  // Extract route path from file name
  // e.g. src/routes/dashboard.tsx → /dashboard
  // e.g. src/routes/settings.index.tsx → /settings
  // e.g. src/routes/clones.$cloneId.tsx → /clones/:cloneId
  let name = file.split("/").pop() ?? "";
  name = name.replace(/\.(tsx|ts|jsx|js)$/, "");
  if (name === "index") return "/";
  // Replace dots with slashes for nested routes
  let path = "/" + name.replace(/\./g, "/");
  // Convert $param to :param
  path = path.replace(/\$(\w+)/g, ":$1");
  // Handle index suffix
  path = path.replace(/\/index$/, "");
  return path || "/";
}

function routeFileToSlug(file: string): string {
  let name = file.split("/").pop() ?? "";
  name = name.replace(/\.(tsx|ts|jsx|js)$/, "");
  if (name === "index") return "home";
  return (
    name.replace(/\./g, "-").replace(/\$/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "") || "root"
  );
}

function routeFileToName(file: string): string {
  const slug = routeFileToSlug(file);
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ─── Cohesion / Coupling Calculation ────────────────────────────────

function calculateMetrics(
  moduleFiles: Set<string>,
  allEdges: ImportEdge[],
): { cohesion: number; coupling: number } {
  let internal = 0;
  let external = 0;

  for (const e of allEdges) {
    if (!moduleFiles.has(e.source_file)) continue;
    if (moduleFiles.has(e.target_file)) internal++;
    else external++;
  }

  const total = internal + external;
  return {
    cohesion: total === 0 ? 1 : internal / total,
    coupling: total === 0 ? 0 : external / total,
  };
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
  if (!apiKey)
    return {
      ok: false,
      runId: "",
      proposed: 0,
      inserted: 0,
      updated: 0,
      orphanAlerts: 0,
      error: "LOVABLE_API_KEY not configured",
    };

  const { data: prime } = await supabase.from("prime_config").select("*").limit(1).maybeSingle();
  if (!prime)
    return {
      ok: false,
      runId: "",
      proposed: 0,
      inserted: 0,
      updated: 0,
      orphanAlerts: 0,
      error: "Configure prime repo first",
    };

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

  // Create run record
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
    return {
      ok: false,
      runId: "",
      proposed: 0,
      inserted: 0,
      updated: 0,
      orphanAlerts: 0,
      error: runErr?.message ?? "Failed to create run",
    };
  }

  const runId = run.id;
  const progress = (phase: string, detail: string, percent: number) => {
    onProgress?.({ runId, phase, detail, percent });
  };

  try {
    // ── Phase 1: Fetch real tree ──
    progress("tree_fetch", "Fetching repository tree from GitHub…", 5);
    const octokit = getAppOctokit();
    const ref: RepoRef = {
      owner: prime.github_owner,
      repo: prime.github_repo,
      branch: prime.default_branch,
    };
    const { files, treeHash } = await fetchRepoTree(octokit, ref);

    // Delta check
    if (config.deltaMode && previousTreeHash === treeHash) {
      await supabase
        .from("module_detection_runs")
        .update({
          status: "completed",
          tree_hash: treeHash,
          file_count: files.length,
          completed_at: new Date().toISOString(),
          error_message: "No changes detected since last scan",
        })
        .eq("id", runId);
      return {
        ok: true,
        runId,
        proposed: 0,
        inserted: 0,
        updated: 0,
        orphanAlerts: 0,
        error: "No changes since last scan",
      };
    }

    const allFilesSet = new Set(files);
    progress("tree_fetch", `Found ${files.length} files`, 15);

    // ── Phase 2: Identify route files ──
    progress("route_detection", "Identifying route files…", 20);
    const routeFiles = identifyRouteFiles(files);
    progress("route_detection", `Found ${routeFiles.length} route files`, 25);

    if (routeFiles.length === 0) {
      await supabase
        .from("module_detection_runs")
        .update({
          status: "completed",
          tree_hash: treeHash,
          file_count: files.length,
          completed_at: new Date().toISOString(),
          error_message: "No route files found in repository",
        })
        .eq("id", runId);
      return {
        ok: true,
        runId,
        proposed: 0,
        inserted: 0,
        updated: 0,
        orphanAlerts: 0,
        error: "No route files found",
      };
    }

    // ── Phase 3: Trace imports for each route ──
    progress("import_tracing", "Tracing import trees for each route…", 30);
    const contentCache = new Map<string, string>();
    const allEdges: ImportEdge[] = [];
    const routeModules: RouteModule[] = [];
    const fileOwnership = new Map<string, string[]>(); // file → [slug, slug, ...]

    for (let i = 0; i < routeFiles.length; i++) {
      const rf = routeFiles[i];
      const pct = 30 + Math.round((i / routeFiles.length) * 40);
      progress("import_tracing", `Tracing ${rf} (${i + 1}/${routeFiles.length})…`, pct);

      const { files: resolvedFiles, edges } = await traceImports(
        rf,
        allFilesSet,
        contentCache,
        octokit,
        ref,
      );
      allEdges.push(...edges);

      const slug = routeFileToSlug(rf);
      const routePath = routeFileToPath(rf);

      // Track ownership
      for (const f of resolvedFiles) {
        const owners = fileOwnership.get(f) ?? [];
        owners.push(slug);
        fileOwnership.set(f, owners);
      }

      const moduleFiles = new Set(resolvedFiles);
      const { cohesion, coupling } = calculateMetrics(moduleFiles, edges);

      routeModules.push({
        name: routeFileToName(rf),
        slug,
        description: `Page module rooted at ${routePath} — includes route component and all imported dependencies.`,
        route_path: routePath,
        entry_file: rf,
        resolved_files: resolvedFiles,
        file_globs: [`${rf.substring(0, rf.lastIndexOf("/") + 1)}**/*`],
        routes: [routePath],
        shared_by_modules: [],
        cohesion_score: Math.round(cohesion * 100) / 100,
        coupling_score: Math.round(coupling * 100) / 100,
        ai_confidence: 1, // deterministic
        ai_reasoning: `Route-first detection: traced ${resolvedFiles.length} files from ${rf} via import graph.`,
        requires: [],
        incompatible_with: [],
      });
    }

    // ── Phase 4: Identify shared files ──
    progress("shared_detection", "Identifying shared files across modules…", 75);
    const sharedFiles: string[] = [];
    for (const [file, owners] of fileOwnership) {
      if (owners.length > 1) {
        sharedFiles.push(file);
        // Tag each module that uses this shared file
        for (const mod of routeModules) {
          if (mod.resolved_files.includes(file)) {
            mod.shared_by_modules = [
              ...new Set([...mod.shared_by_modules, ...owners.filter((o) => o !== mod.slug)]),
            ];
          }
        }
      }
    }

    // Create a "shared" module for files used by 2+ routes
    if (sharedFiles.length > 0) {
      const sharedSet = new Set(sharedFiles);
      const { cohesion, coupling } = calculateMetrics(sharedSet, allEdges);
      const ownerSlugs = [...new Set(sharedFiles.flatMap((f) => fileOwnership.get(f) ?? []))];

      routeModules.push({
        name: "Shared / Core",
        slug: "shared-core",
        description: `Files imported by ${ownerSlugs.length} modules — shared components, hooks, utilities, and types.`,
        route_path: "",
        entry_file: "src/",
        resolved_files: sharedFiles,
        file_globs: ["src/components/**/*", "src/lib/**/*", "src/hooks/**/*"],
        routes: [],
        shared_by_modules: ownerSlugs,
        cohesion_score: Math.round(cohesion * 100) / 100,
        coupling_score: Math.round(coupling * 100) / 100,
        ai_confidence: 1,
        ai_reasoning: `${sharedFiles.length} files are imported by 2 or more route modules. These form the shared infrastructure layer.`,
        requires: [],
        incompatible_with: [],
      });
    }

    // ── Phase 5: Find orphan files ──
    const coveredFiles = new Set<string>();
    for (const mod of routeModules) {
      for (const f of mod.resolved_files) coveredFiles.add(f);
    }
    const orphanFiles = files
      .filter((f) => !coveredFiles.has(f))
      .filter((f) => /\.(ts|tsx|js|jsx)$/.test(f))
      .filter((f) => !f.includes("routeTree.gen") && !f.includes("__root"));

    // Store import edges
    if (allEdges.length > 0) {
      const uniqueEdges = new Map<string, ImportEdge>();
      for (const e of allEdges) {
        uniqueEdges.set(`${e.source_file}→${e.target_file}`, e);
      }
      const edgeRows = [...uniqueEdges.values()].slice(0, 1000).map((e) => ({
        detection_run_id: runId,
        source_file: e.source_file,
        target_file: e.target_file,
        import_type: e.import_type,
      }));
      await supabase.from("module_import_edges").insert(edgeRows);
    }

    // ── Persist modules ──
    progress("persisting", "Saving detection results…", 85);
    let inserted = 0;
    let updated = 0;
    const globRejections: Array<{ slug: string; reason: string; glob: string }> = [];

    for (const m of routeModules) {
      // Sanitise file_globs before hitting the DB: a bad glob here poisons
      // every downstream cascade / tree-walk / re-sync for this module.
      const { valid: safeGlobs, invalid: badGlobs } = validateModuleGlobs(m.file_globs);
      for (const bad of badGlobs) {
        globRejections.push({ slug: m.slug, glob: bad.glob, reason: bad.reason });
      }
      m.file_globs = safeGlobs;
      if (safeGlobs.length === 0) {
        // Skip modules whose entire glob set was rejected — writing an empty
        // list would silently disable cascades for this module.
        continue;
      }

      const { data: existing } = await supabase
        .from("modules")
        .select("id, status")
        .eq("slug", m.slug)
        .maybeSingle();

      if (existing) {
        if (existing.status === "proposed" || existing.status === "rejected") {
          await supabase
            .from("modules")
            .update({
              name: m.name,
              description: m.description,
              file_globs: m.file_globs,
              routes: m.routes,
              route_entry_file: m.entry_file,
              resolved_files: m.resolved_files,
              shared_by_modules: m.shared_by_modules,
              ai_confidence: m.ai_confidence,
              ai_reasoning: m.ai_reasoning,
              cohesion_score: m.cohesion_score,
              coupling_score: m.coupling_score,
              requires: m.requires,
              incompatible_with: m.incompatible_with,
              detection_run_id: runId,
              tree_snapshot_hash: treeHash,
            })
            .eq("id", existing.id);
          updated++;
        }
      } else {
        const { error } = await supabase.from("modules").insert({
          name: m.name,
          slug: m.slug,
          description: m.description,
          file_globs: m.file_globs,
          routes: m.routes,
          route_entry_file: m.entry_file,
          resolved_files: m.resolved_files,
          shared_by_modules: m.shared_by_modules,
          ai_confidence: m.ai_confidence,
          ai_reasoning: m.ai_reasoning,
          cohesion_score: m.cohesion_score,
          coupling_score: m.coupling_score,
          requires: m.requires,
          incompatible_with: m.incompatible_with,
          status: "proposed",
          detected_by_ai: false,
          detection_run_id: runId,
          tree_snapshot_hash: treeHash,
        });
        if (!error) inserted++;
      }
    }

    // Drift alerts for orphans
    let orphanAlerts = 0;
    if (orphanFiles.length > 0) {
      progress("drift_alerts", "Creating drift alerts for uncovered files…", 90);
      const alerts = orphanFiles.slice(0, 100).map((f) => ({
        detection_run_id: runId,
        alert_type: "orphan_file",
        file_path: f,
        reasoning: `File not reachable from any route's import tree`,
        severity: "info",
      }));
      const { error: alertErr } = await supabase.from("module_drift_alerts").insert(alerts);
      if (!alertErr) orphanAlerts = alerts.length;
    }

    // Finalize run
    progress("complete", "Detection complete!", 100);
    const passes: PassResult[] = [
      {
        pass: 1,
        name: "Route-first import tracing",
        model: "deterministic",
        duration_ms: 0,
        modules_proposed: routeModules.length,
        summary: `Traced ${routeModules.length} route modules from ${routeFiles.length} route files, ${sharedFiles.length} shared files, ${orphanFiles.length} orphans`,
      },
    ];

    await supabase
      .from("module_detection_runs")
      .update({
        status: "completed",
        tree_hash: treeHash,
        file_count: files.length,
        sampled_file_count: contentCache.size,
        dependency_count: allEdges.length,
        pass_count: passes.length,
        passes: JSON.parse(JSON.stringify(passes)),
        proposed_modules: routeModules.length,
        inserted_modules: inserted,
        updated_modules: updated,
        orphan_files_found: orphanAlerts,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);

    await supabase.from("audit_log").insert({
      action: "module.route_detection_complete",
      entity_type: "module_detection_run",
      entity_id: runId,
      actor_user_id: userId,
      metadata: {
        strategy: config.strategy,
        file_count: files.length,
        route_files: routeFiles.length,
        proposed: routeModules.length,
        shared_files: sharedFiles.length,
        orphan_files: orphanFiles.length,
        inserted,
        updated,
        rejected_globs: globRejections.slice(0, 50),
        rejected_glob_count: globRejections.length,
      },
    });

    return { ok: true, runId, proposed: routeModules.length, inserted, updated, orphanAlerts };
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    console.error("Detection run failed:", errorMsg);
    await supabase
      .from("module_detection_runs")
      .update({
        status: "failed",
        error_message: errorMsg,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);
    return {
      ok: false,
      runId,
      proposed: 0,
      inserted: 0,
      updated: 0,
      orphanAlerts: 0,
      error: errorMsg,
    };
  }
}

// ─── Cross-Clone Intelligence ───────────────────────────────────────

export async function analyzeModuleIntelligence(supabase: Supabase): Promise<{
  coInstallation: Array<{ module_a: string; module_b: string; coInstallRate: number }>;
  healthScores: Array<{
    moduleId: string;
    moduleName: string;
    score: number;
    breakdown: Record<string, number>;
  }>;
}> {
  const { data: cloneModules } = await supabase
    .from("clone_modules")
    .select("clone_id, module_id, modules(name, slug)");

  const byClone = new Map<string, string[]>();
  const moduleNames = new Map<string, string>();
  for (const row of (cloneModules ?? []) as Array<{
    clone_id: string;
    module_id: string;
    modules: { name: string; slug: string } | null;
  }>) {
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

  const { data: modules } = await supabase
    .from("modules")
    .select("id, name, slug, ai_confidence, cohesion_score, coupling_score");
  const { data: clones } = await supabase.from("clones").select("id, sync_status");

  const cloneStatusMap = new Map<string, string>();
  for (const c of clones ?? []) cloneStatusMap.set(c.id, c.sync_status);

  const healthScores = (modules ?? [])
    .map((m) => {
      const moduleClones = (cloneModules ?? [])
        .filter((cm: { module_id: string }) => cm.module_id === m.id)
        .map((cm: { clone_id: string }) => cm.clone_id);

      const inSync = moduleClones.filter(
        (cid: string) => cloneStatusMap.get(cid) === "in_sync",
      ).length;
      const failed = moduleClones.filter(
        (cid: string) => cloneStatusMap.get(cid) === "failed",
      ).length;

      const syncRate = moduleClones.length > 0 ? inSync / moduleClones.length : 0;
      const failRate = moduleClones.length > 0 ? failed / moduleClones.length : 0;
      const cohesion = Number(m.cohesion_score) || 0.5;
      const coupling = Number(m.coupling_score) || 0.5;
      const confidence = Number(m.ai_confidence) || 0.5;
      const coverage = totalClones > 0 ? moduleClones.length / totalClones : 0;

      const score =
        Math.round(
          (syncRate * 30 +
            (1 - failRate) * 25 +
            cohesion * 20 +
            (1 - coupling) * 15 +
            confidence * 10) *
            100,
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
    })
    .sort((a, b) => b.score - a.score);

  return { coInstallation, healthScores };
}
