import { createFileRoute, Link, useParams, notFound } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ProtectedRoute } from "@/components/protected-route";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Boxes, Waves, ChevronRight } from "lucide-react";
import { StatusPill } from "@/components/status-pill";
import { formatDistanceToNow } from "@/lib/format";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { bulkSyncModuleFn } from "@/server/module-sync.functions";
import type { Database } from "@/integrations/supabase/types";

type Module = Database["public"]["Tables"]["modules"]["Row"];
type Clone = Database["public"]["Tables"]["clones"]["Row"];

export const Route = createFileRoute("/modules/$slug")({
  component: () => (
    <ProtectedRoute>
      <ModuleDetail />
    </ProtectedRoute>
  ),
  notFoundComponent: () => (
    <div className="space-y-3">
      <Link to="/modules" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="mr-1 h-4 w-4" /> modules
      </Link>
      <div>Module not found.</div>
    </div>
  ),
});

function ModuleDetail() {
  const { slug } = useParams({ from: "/modules/$slug" });
  const [module, setModule] = useState<Module | null>(null);
  const [clones, setClones] = useState<Clone[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const bulkSync = useServerFn(bulkSyncModuleFn);

  const load = async () => {
    setLoading(true);
    const { data: m } = await supabase
      .from("modules")
      .select("*")
      .eq("slug", slug)
      .maybeSingle();
    setModule(m ?? null);
    if (m) {
      const { data: cm } = await supabase
        .from("clone_modules")
        .select("clone_id, clones(*)")
        .eq("module_id", m.id);
      setClones(
        ((cm ?? []) as Array<{ clones: Clone | null }>)
          .map((r) => r.clones)
          .filter((c): c is Clone => Boolean(c)),
      );
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [slug]);

  const syncAll = async () => {
    if (!module) return;
    setSyncing(true);
    try {
      const res = await bulkSync({
        data: {
          moduleId: module.id,
          cloneIds: clones.map((c) => c.id),
          action: "install",
          cascade: true,
          cascadeMode: "pr",
        },
      });
      if (!res.ok) {
        toast.error(res.error ?? "Sync failed");
      } else {
        toast.success(`Sync-all queued — ${clones.length} clone(s)`);
        load();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return <div className="font-mono text-sm text-muted-foreground">loading…</div>;
  }

  if (!module) {
    throw notFound();
  }

  const globCount = (module.file_globs ?? []).length;
  const behind = clones.filter((c) => c.sync_status === "behind").length;
  const failed = clones.filter((c) => c.sync_status === "failed").length;
  const inSync = clones.filter((c) => c.sync_status === "in_sync").length;

  return (
    <div className="space-y-6">
      <Link
        to="/modules"
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-1 h-4 w-4" /> modules
      </Link>

      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
            module health
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{module.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline" className="font-mono text-[10px] uppercase">
              {module.status}
            </Badge>
            <span className="font-mono">{module.slug}</span>
            <span className="font-mono">· {globCount} glob{globCount === 1 ? "" : "s"}</span>
          </div>
        </div>
        <Button onClick={syncAll} disabled={syncing || clones.length === 0 || globCount === 0}>
          <Waves className="mr-2 h-4 w-4" />
          {syncing ? "Queueing…" : `Sync-all (${clones.length})`}
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <StatTile label="installed on" value={clones.length} />
        <StatTile label="in sync" value={inSync} tone="success" />
        <StatTile label="behind" value={behind} tone="warning" />
        <StatTile label="failed" value={failed} tone="destructive" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Coverage</CardTitle>
          <CardDescription>Clones with this module installed and their current sync state.</CardDescription>
        </CardHeader>
        <CardContent>
          {clones.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              <Boxes className="mx-auto mb-2 h-5 w-5" />
              No clones have this module installed yet.
            </div>
          ) : (
            <div className="space-y-2">
              {clones.map((c) => (
                <Link
                  key={c.id}
                  to="/clones/$cloneId"
                  params={{ cloneId: c.id }}
                  className="block"
                >
                  <Card className="border-border/80 transition-colors hover:border-primary/40">
                    <CardContent className="flex items-center justify-between p-4">
                      <div className="min-w-0">
                        <div className="font-mono text-sm font-medium">{c.name}</div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {c.github_owner}/{c.github_repo}
                          {c.last_cascade_at && <> · last cascade {formatDistanceToNow(c.last_cascade_at)}</>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusPill status={c.sync_status} behind={c.commits_behind} />
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">File globs</CardTitle>
          <CardDescription>Only files matching these patterns get pushed during a scoped sync.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-1.5">
            {(module.file_globs ?? []).map((g) => (
              <code key={g} className="rounded bg-muted px-2 py-1 font-mono text-[11px]">
                {g}
              </code>
            ))}
            {(module.file_globs ?? []).length === 0 && (
              <span className="text-sm text-muted-foreground">No globs configured.</span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success" | "warning" | "destructive";
}) {
  const toneCls =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "destructive"
          ? "text-destructive"
          : "text-foreground";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div className={`mt-1 text-2xl font-semibold ${toneCls}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
