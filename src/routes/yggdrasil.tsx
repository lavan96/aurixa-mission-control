import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/protected-route";
import { AppShell } from "@/components/app-shell";
import { useClones, usePrimeConfig } from "@/lib/queries";
import { YggdrasilTree } from "@/components/yggdrasil/yggdrasil-tree";
import { TreeStats } from "@/components/yggdrasil/tree-stats";
import { TreePine } from "lucide-react";

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

function YggdrasilPage() {
  const { data: clones, loading } = useClones();
  const { data: prime } = usePrimeConfig();

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
        <YggdrasilTree clones={clones} primeName={primeName} />
      )}
    </div>
  );
}
