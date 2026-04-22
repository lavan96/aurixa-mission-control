import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, useCallback, useRef } from "react";
import { ProtectedRoute } from "@/components/protected-route";
import { AppShell } from "@/components/app-shell";
import { useClones, usePrimeConfig } from "@/lib/queries";
import { YggdrasilTree } from "@/components/yggdrasil/yggdrasil-tree";
import { TreeStats } from "@/components/yggdrasil/tree-stats";
import { YggdrasilToolbar, type StatusFilter } from "@/components/yggdrasil/yggdrasil-toolbar";
import { TreePine } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { fetchFleetHealth } from "@/server/fleet-health.functions";
import { toast } from "sonner";
import type { TreeNode } from "@/components/yggdrasil/use-tree-layout";

export const Route = createFileRoute("/yggdrasil")({
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

function YggdrasilPage() {
  const { data: clones, loading, refresh: refreshClones } = useClones();
  const { data: prime } = usePrimeConfig();

  const [activeFilters, setActiveFilters] = useState<StatusFilter[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);
  const [descendantFilterEnabled, setDescendantFilterEnabled] = useState(false);

  /** Reference to tree container dimensions for centering calculations */
  const treeDimensionsRef = useRef({ width: 1000, height: 700 });
  /** Exposed node positions from the layout */
  const layoutNodesRef = useRef<TreeNode[]>([]);

  const fetchHealthFn = useServerFn(fetchFleetHealth);

  const filteredClones = useMemo(() => {
    let result = clones;

    // Status filters
    if (activeFilters.length > 0) {
      result = result.filter((c) => activeFilters.includes(c.sync_status as StatusFilter));
    }

    // Descendant filter — when enabled and a node is selected, only show descendants
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

  /** Auto-pan & zoom to center the selected node */
  const handleSearchSelect = useCallback((id: string) => {
    setHighlightId(id);
    setSearchQuery("");

    // Find the node in the layout to get its coordinates
    const targetNode = layoutNodesRef.current.find((n) => n.id === id);
    if (targetNode) {
      const dims = treeDimensionsRef.current;
      const targetZoom = 1.5;
      // Center the node in the viewport
      const panX = dims.width / 2 - targetNode.x * targetZoom;
      const panY = dims.height / 2 - targetNode.y * targetZoom;
      setZoom(targetZoom);
      setPan({ x: panX, y: panY });
    }

    setTimeout(() => setHighlightId(null), 4000);
  }, []);

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

  const handleZoomIn = () => setZoom((z) => Math.min(3, z + 0.2));
  const handleZoomOut = () => setZoom((z) => Math.max(0.3, z - 0.2));
  const handleZoomReset = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

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
        activeFilters={activeFilters}
        onFiltersChange={setActiveFilters}
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
        descendantFilterEnabled={descendantFilterEnabled}
        onDescendantFilterToggle={setDescendantFilterEnabled}
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
          onNodeSelect={setSelectedNode}
        />
      )}
    </div>
  );
}
