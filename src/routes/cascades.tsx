import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { ProtectedRoute } from "@/components/protected-route";
import { useCascadeEvents, useClones } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Waves, GitMerge, Send, Bell, ChevronRight, Package } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatDistanceToNow } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useServerFn } from "@tanstack/react-start";
import { runCascade } from "@/server/cascade-engine.functions";
import { CardRowSkeleton } from "@/components/list-skeletons";
import { EmptyState } from "@/components/empty-state";

const MODE_VALUES = ["pr", "auto_merge", "notify"] as const;
const SCOPE_VALUES = ["all", "selected"] as const;

const searchSchema = z.object({
  mode: fallback(z.enum(MODE_VALUES), "pr").default("pr"),
  scope: fallback(z.enum(SCOPE_VALUES), "all").default("all"),
});

export const Route = createFileRoute("/cascades")({
  validateSearch: zodValidator(searchSchema),
  component: () => (
    <ProtectedRoute>
      <CascadesPage />
    </ProtectedRoute>
  ),
  head: () => ({ meta: [{ title: "Cascades — Aurixa Systems Mission Control" }] }),
});

type Mode = (typeof MODE_VALUES)[number];

function CascadesPage() {
  const { data: events, loading: eventsLoading, refresh } = useCascadeEvents();
  const { data: clones } = useClones();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/cascades" });
  const mode = search.mode;
  const scope = search.scope;

  type SearchState = typeof search;
  const setMode = useCallback(
    (m: Mode) =>
      void navigate({
        search: (prev: SearchState) => ({ ...prev, mode: m }),
        replace: true,
      }),
    [navigate],
  );
  const setScope = useCallback(
    (s: (typeof SCOPE_VALUES)[number]) =>
      void navigate({
        search: (prev: SearchState) => ({ ...prev, scope: s }),
        replace: true,
      }),
    [navigate],
  );

  const [busy, setBusy] = useState(false);
  const runCascadeFn = useServerFn(runCascade);

  const fire = async () => {
    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: ev, error } = await supabase
      .from("cascade_events")
      .insert({
        trigger: "manual",
        mode,
        status: "pending",
        scope_filter: { scope },
        initiated_by: user?.id,
      })
      .select()
      .single();
    if (error || !ev) {
      toast.error(error?.message || "Failed to start cascade");
      setBusy(false);
      return;
    }
    const targets = clones;
    if (targets.length > 0) {
      await supabase.from("cascade_results").insert(
        targets.map((c) => ({
          cascade_event_id: ev.id,
          clone_id: c.id,
          status: "queued" as const,
        })),
      );
    }
    toast.info(`Queued ${targets.length} clones — executing…`);
    refresh();

    try {
      const res = await runCascadeFn({ data: { cascadeEventId: ev.id } });
      if (!res.ok) {
        toast.error(res.error);
      } else {
        const { succeeded, opened, failed, skipped } = res.counts;
        toast.success(
          `Cascade ${res.status}: ${succeeded} merged · ${opened} PRs · ${failed} failed · ${skipped} skipped`,
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Engine failed");
    }
    setBusy(false);
    refresh();
  };

  return (
    <div className="space-y-6">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
          waterfall
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Cascades</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Push prime updates downstream. Strictly one-direction — clones never push back.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">New cascade</CardTitle>
          <CardDescription>Filter by module is automatic — only files belonging to modules each clone has installed get applied.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div>
            <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              mode
            </div>
            <div className="grid gap-2 md:grid-cols-3">
              <ModeCard active={mode === "pr"} icon={<GitMerge />} title="Open PR" desc="Safe — review before merging." onClick={() => setMode("pr")} />
              <ModeCard active={mode === "auto_merge"} icon={<Send />} title="Auto-merge" desc="Push & merge automatically." onClick={() => setMode("auto_merge")} />
              <ModeCard active={mode === "notify"} icon={<Bell />} title="Notify only" desc="No commits — just flag drift." onClick={() => setMode("notify")} />
            </div>
          </div>
          <div>
            <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              scope
            </div>
            <div className="flex gap-2">
              <Button variant={scope === "all" ? "default" : "outline"} onClick={() => setScope("all")}>
                All clones ({clones.length})
              </Button>
              <Button variant={scope === "selected" ? "default" : "outline"} onClick={() => setScope("selected")}>
                Tagged group
              </Button>
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={fire} disabled={busy || clones.length === 0}>
              <Waves className="mr-2 h-4 w-4" />
              {busy ? "Queueing…" : "Fire cascade"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <section>
        <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
          history
        </h2>
        {eventsLoading ? (
          <div className="space-y-2">
            <CardRowSkeleton />
            <CardRowSkeleton />
            <CardRowSkeleton />
          </div>
        ) : events.length === 0 ? (
          <EmptyState
            icon={<Waves />}
            title="No cascades yet"
            description="Fire your first cascade above to push prime updates downstream. Every run lands in this history."
          />
        ) : (
          <div className="space-y-2">
            {events.map((e) => (
              <Link
                key={e.id}
                to="/cascades/$eventId"
                params={{ eventId: e.id }}
                className="block"
              >
                <Card className="border-border/80 transition-colors hover:border-primary/40">
                  <CardContent className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-info/15 text-info">
                        <Waves className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-medium">{e.mode.replace("_", " ")}</span>
                          <Badge variant="outline" className="text-[10px] uppercase">{e.trigger}</Badge>
                          <Badge variant="outline" className={cn("text-[10px] uppercase", statusTone(e.status))}>
                            {e.status}
                          </Badge>
                          {(() => {
                            const sf = (e.scope_filter ?? {}) as {
                              scope?: string;
                              module_name?: string;
                              module_globs?: string[];
                            };
                            if (sf.scope !== "module_sync") return null;
                            const globCount = sf.module_globs?.length ?? 0;
                            return (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span
                                    className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-primary"
                                    onClick={(ev) => ev.preventDefault()}
                                  >
                                    <Package className="h-3 w-3" />
                                    module · {sf.module_name ?? "scoped"}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  Scoped module sync — pushes only {globCount} glob
                                  {globCount === 1 ? "" : "s"}
                                </TooltipContent>
                              </Tooltip>
                            );
                          })()}
                        </div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {formatDistanceToNow(e.created_at)}
                          {e.summary && <> · {e.summary}</>}
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function statusTone(s: string) {
  switch (s) {
    case "completed":
      return "border-success/40 text-success";
    case "failed":
      return "border-destructive/40 text-destructive";
    case "running":
      return "border-info/40 text-info animate-pulse";
    case "partial":
      return "border-warning/40 text-warning";
    default:
      return "border-muted text-muted-foreground";
  }
}

function ModeCard({
  active,
  icon,
  title,
  desc,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border p-3 text-left transition-colors",
        active ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
      )}
    >
      <div className={cn("mb-2 [&>svg]:h-4 [&>svg]:w-4", active ? "text-primary" : "text-muted-foreground")}>
        {icon}
      </div>
      <div className="font-mono text-sm font-semibold">{title}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{desc}</div>
    </button>
  );
}
