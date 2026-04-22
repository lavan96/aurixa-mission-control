import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { ProtectedRoute } from "@/components/protected-route";
import { AppShell } from "@/components/app-shell";
import { useClones, usePrimeConfig } from "@/lib/queries";
import { YggdrasilTree } from "@/components/yggdrasil/yggdrasil-tree";
import { TreeStats } from "@/components/yggdrasil/tree-stats";
import { YggdrasilToolbar, type StatusFilter } from "@/components/yggdrasil/yggdrasil-toolbar";
import { TreePine } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { fetchFleetHealth } from "@/server/fleet-health.functions";
import { toast } from "sonner";
import type { TreeNode } from "@/components/yggdrasil/use-tree-layout";

const yggdrasilSearchSchema = z.object({
  filters: fallback(z.array(z.enum(["in_sync", "behind", "failed"])), []).default([]),
  zoom: fallback(z.number(), 1).default(1),
  panX: fallback(z.number(), 0).default(0),
  panY: fallback(z.number(), 0).default(0),
  selected: fallback(z.string(), "").default(""),
  descendants: fallback(z.boolean(), false).default(false),
});

export const Route = createFileRoute("/yggdrasil")({
  validateSearch: zodValidator(yggdrasilSearchSchema),
  component: () => (
    <ProtectedRoute>
      <AppShell>
        <YggdrasilPage />
      </AppShell>
    </ProtectedRoute>
  ),
  head: () => ({
    meta: [
      { title: "Yggdrasil — Aurixa Systems Mission Control" },
      { name: "description", content: "The World Tree — a living visualization of your clone fleet." },
    ],
  }),
});

/** Collect all descendant IDs from a node recursively */
function collectDescendantIds(node: TreeNode): Set<string> {
  const ids = new Set<string>();
  function walk(n: TreeNode) {
    for (const child of n.children) {
      ids.add(child.id);
      walk(child);
    }
  }
  walk(node);
  return ids;
}

/** Collect all descendants (nodes) recursively */
function collectDescendants(node: TreeNode): TreeNode[] {
  const result: TreeNode[] = [];
  function walk(n: TreeNode) {
    for (const child of n.children) {
      result.push(child);
      walk(child);
    }
  }
  walk(node);
  return result;
}

/** Find sibling nodes of a node, including itself */
function findSiblings(node: TreeNode, allNodes: TreeNode[]): TreeNode[] {
  if (!node.parentId) return [node];
  const parent = allNodes.find((n) => n.id === node.parentId);
  return parent ? parent.children : [node];
}

function YggdrasilPage() {
  const { data: clones, loading, refresh: refreshClones } = useClones();
  const { data: prime } = usePrimeConfig();
  const navigate = useNavigate({ from: "/yggdrasil" });
  const search = Route.useSearch();

  // Derive state from URL search params
  const activeFilters = search.filters as StatusFilter[];
  const zoom = search.zoom;
  const pan = useMemo(() => ({ x: search.panX, y: search.panY }), [search.panX, search.panY]);
  const descendantFilterEnabled = search.descendants;

  const [searchQuery, setSearchQuery] = useState("");
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Staged filters for preview-before-apply
  const [stagedFilters, setStagedFilters] = useState<StatusFilter[]>(activeFilters);
  const [stagedDescendant, setStagedDescendant] = useState(descendantFilterEnabled);
  const [hasUncommittedChanges, setHasUncommittedChanges] = useState(false);

  // Sync staged state when URL params change externally
  useEffect(() => {
    setStagedFilters(activeFilters);
    setStagedDescendant(descendantFilterEnabled);
    setHasUncommittedChanges(false);
  }, [activeFilters, descendantFilterEnabled]);

  /** Reference to tree container dimensions for centering calculations */
  const treeDimensionsRef = useRef({ width: 1000, height: 700 });
  /** Exposed node positions from the layout */
  const layoutNodesRef = useRef<TreeNode[]>([]);

  const fetchHealthFn = useServerFn(fetchFleetHealth);

  // Resolve selected node from URL param
  const selectedNode = useMemo(() => {
    if (!search.selected) return null;
    return layoutNodesRef.current.find((n) => n.id === search.selected) ?? null;
  }, [search.selected, layoutNodesRef.current]);

  const filteredClones = useMemo(() => {
    let result = clones;

    if (activeFilters.length > 0) {
      result = result.filter((c) => activeFilters.includes(c.sync_status as StatusFilter));
    }

    if (descendantFilterEnabled && selectedNode && selectedNode.id !== "__trunk__") {
      const descendantIds = collectDescendantIds(selectedNode);
      descendantIds.add(selectedNode.id);
      result = result.filter((c) => descendantIds.has(c.id));
    }

    return result;
  }, [clones, activeFilters, descendantFilterEnabled, selectedNode]);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return clones
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.github_repo.toLowerCase().includes(q) ||
          c.github_owner.toLowerCase().includes(q),
      )
      .slice(0, 8)
      .map((c) => ({ id: c.id, name: c.name, repo: `${c.github_owner}/${c.github_repo}` }));
  }, [clones, searchQuery]);

  // Helper to update search params
  const updateSearch = useCallback(
    (updates: Partial<z.infer<typeof yggdrasilSearchSchema>>) => {
      navigate({ search: (prev: z.infer<typeof yggdrasilSearchSchema>) => ({ ...prev, ...updates }), replace: true });
    },
    [navigate],
  );

  const setActiveFilters = useCallback(
    (filters: StatusFilter[]) => updateSearch({ filters }),
    [updateSearch],
  );
  const setZoom = useCallback((z: number) => updateSearch({ zoom: z }), [updateSearch]);
  const setPan = useCallback(
    (p: { x: number; y: number }) => updateSearch({ panX: p.x, panY: p.y }),
    [updateSearch],
  );
  const setSelectedNodeId = useCallback(
    (id: string) => updateSearch({ selected: id }),
    [updateSearch],
  );
  const setDescendantFilterEnabled = useCallback(
    (val: boolean) => updateSearch({ descendants: val }),
    [updateSearch],
  );

  /** Auto-pan & zoom to center the selected node */
  const handleSearchSelect = useCallback(
    (id: string) => {
      setHighlightId(id);
      setSearchQuery("");

      const targetNode = layoutNodesRef.current.find((n) => n.id === id);
      if (targetNode) {
        const dims = treeDimensionsRef.current;
        const targetZoom = 1.5;
        const panX = dims.width / 2 - targetNode.x * targetZoom;
        const panY = dims.height / 2 - targetNode.y * targetZoom;
        updateSearch({ zoom: targetZoom, panX, panY, selected: id });
      }

      setTimeout(() => setHighlightId(null), 4000);
    },
    [updateSearch],
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchHealthFn({ data: { force: true } });
      await refreshClones();
      toast.success("Fleet statuses refreshed");
    } catch {
      toast.error("Failed to refresh statuses");
    } finally {
      setRefreshing(false);
    }
  }, [fetchHealthFn, refreshClones]);

  const handleZoomIn = () => setZoom(Math.min(3, zoom + 0.2));
  const handleZoomOut = () => setZoom(Math.max(0.3, zoom - 0.2));
  const handleZoomReset = () => updateSearch({ zoom: 1, panX: 0, panY: 0 });

  const handleNodeSelect = useCallback(
    (node: TreeNode | null) => {
      updateSearch({ selected: node?.id ?? "" });
    },
    [updateSearch],
  );

  // Staged filter handlers
  const handleStagedFiltersChange = useCallback((filters: StatusFilter[]) => {
    setStagedFilters(filters);
    setHasUncommittedChanges(true);
  }, []);

  const handleStagedDescendantToggle = useCallback((val: boolean) => {
    setStagedDescendant(val);
    setHasUncommittedChanges(true);
  }, []);

  const handleApplyFilters = useCallback(() => {
    updateSearch({ filters: stagedFilters, descendants: stagedDescendant });
    setHasUncommittedChanges(false);
  }, [stagedFilters, stagedDescendant, updateSearch]);

  const handleClearFilters = useCallback(() => {
    setStagedFilters([]);
    setStagedDescendant(false);
    setHasUncommittedChanges(true);
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't capture if user is typing in an input
      if ((e.target as HTMLElement).closest("input, textarea, [contenteditable]")) return;

      const nodes = layoutNodesRef.current;
      if (nodes.length === 0) return;

      const currentId = search.selected;
      const currentNode = currentId ? nodes.find((n) => n.id === currentId) : null;

      if (e.key === "Escape") {
        e.preventDefault();
        handleNodeSelect(null);
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (!currentNode) {
          // Select trunk's first child
          const trunk = nodes.find((n) => n.id === "__trunk__");
          if (trunk && trunk.children.length > 0) {
            handleNodeSelect(trunk.children[0]);
            centerOnNode(trunk.children[0]);
          }
          return;
        }
        // Navigate to first child
        if (currentNode.children.length > 0) {
          handleNodeSelect(currentNode.children[0]);
          centerOnNode(currentNode.children[0]);
        }
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (!currentNode) return;
        // Navigate to parent
        if (currentNode.parentId) {
          const parent = nodes.find((n) => n.id === currentNode.parentId);
          if (parent && parent.id !== "__trunk__") {
            handleNodeSelect(parent);
            centerOnNode(parent);
          } else if (parent?.id === "__trunk__") {
            handleNodeSelect(null);
          }
        }
        return;
      }

      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        if (!currentNode) return;
        const siblings = findSiblings(currentNode, nodes);
        const idx = siblings.findIndex((s) => s.id === currentNode.id);
        const next =
          e.key === "ArrowLeft"
            ? siblings[(idx - 1 + siblings.length) % siblings.length]
            : siblings[(idx + 1) % siblings.length];
        if (next && next.id !== currentNode.id) {
          handleNodeSelect(next);
          centerOnNode(next);
        }
        return;
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [search.selected, handleNodeSelect]);

  const centerOnNode = useCallback(
    (node: TreeNode) => {
      const dims = treeDimensionsRef.current;
      const targetZoom = Math.max(zoom, 1.2);
      const panX = dims.width / 2 - node.x * targetZoom;
      const panY = dims.height / 2 - node.y * targetZoom;
      updateSearch({ zoom: targetZoom, panX, panY });
    },
    [zoom, updateSearch],
  );

  const primeName = prime ? `${prime.github_owner}/${prime.github_repo}` : undefined;

  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/15 ring-1 ring-primary/40">
            <TreePine className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
              fleet visualization
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">
              Yggdrasil
              <span className="ml-3 font-mono text-sm font-normal text-muted-foreground">
                the world tree
              </span>
            </h1>
          </div>
        </div>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          A living map of the Aurixa fleet. Each root represents a clone cascading from
          the prime repository — the trunk. Watch the tree grow as you add more clones.
        </p>
      </header>

      <TreeStats clones={clones} />

      <YggdrasilToolbar
        activeFilters={stagedFilters}
        onFiltersChange={handleStagedFiltersChange}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchResults={searchResults}
        onSearchSelect={handleSearchSelect}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        zoom={zoom}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onZoomReset={handleZoomReset}
        selectedNode={selectedNode}
        descendantFilterEnabled={stagedDescendant}
        onDescendantFilterToggle={handleStagedDescendantToggle}
        hasUncommittedChanges={hasUncommittedChanges}
        onApplyFilters={handleApplyFilters}
        onClearFilters={handleClearFilters}
      />

      {loading ? (
        <div className="flex h-[500px] items-center justify-center rounded-xl border border-border/40 bg-background">
          <div className="text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="mt-3 font-mono text-xs text-muted-foreground">
              Summoning the world tree…
            </p>
          </div>
        </div>
      ) : (
        <YggdrasilTree
          clones={filteredClones}
          primeName={primeName}
          highlightId={highlightId}
          zoom={zoom}
          pan={pan}
          onPanChange={setPan}
          onLayoutReady={(nodes, dims) => {
            layoutNodesRef.current = nodes;
            treeDimensionsRef.current = dims;
          }}
          onNodeSelect={handleNodeSelect}
          selectedNodeId={search.selected || null}
        />
      )}
    </div>
  );
}
