import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Waves,
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  Rocket,
  RotateCcw,
  Eye,
  Undo2,
  Filter,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useClones, type Clone } from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { runCascade } from "@/server/cascade-engine.functions";
import { assessBlastRadius } from "@/lib/blast-radius";

type CloneProgress = {
  clone_id: string;
  name: string;
  status: "queued" | "running" | "succeeded" | "failed" | "skipped";
  error?: string;
  pr_url?: string;
  previous_sha?: string;
};

type SyncFilter = "all" | "synced" | "behind" | "diverged" | "unknown";
type TimeFilter = "all" | "24h" | "7d" | "30d";

export function BulkCascadeCard() {
  const { data: clones } = useClones();
  const runCascadeFn = useServerFn(runCascade);
  const [running, setRunning] = useState(false);
  const [eventId, setEventId] = useState<string | null>(null);
  const [progress, setProgress] = useState<CloneProgress[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // Filters
  const [nameFilter, setNameFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<SyncFilter>("all");
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");

  const filteredClones = useMemo(() => {
    let result = clones;
    if (nameFilter) {
      const q = nameFilter.toLowerCase();
      result = result.filter(
        (c) => c.name.toLowerCase().includes(q) || c.slug.toLowerCase().includes(q),
      );
    }
    if (statusFilter !== "all") {
      result = result.filter((c) => c.sync_status === statusFilter);
    }
    if (timeFilter !== "all") {
      const now = Date.now();
      const cutoffs: Record<string, number> = {
        "24h": 24 * 60 * 60 * 1000,
        "7d": 7 * 24 * 60 * 60 * 1000,
        "30d": 30 * 24 * 60 * 60 * 1000,
      };
      const cutoff = cutoffs[timeFilter];
      if (cutoff) {
        result = result.filter((c) => {
          const updated = c.updated_at ? new Date(c.updated_at).getTime() : 0;
          return now - updated <= cutoff;
        });
      }
    }
    return result;
  }, [clones, nameFilter, statusFilter, timeFilter]);

  const completed = progress.filter(
    (p) => p.status === "succeeded" || p.status === "failed" || p.status === "skipped",
  ).length;
  const total = progress.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const succeeded = progress.filter((p) => p.status === "succeeded").length;
  const failed = progress.filter((p) => p.status === "failed").length;
  const failedClones = progress.filter((p) => p.status === "failed");

  // Realtime subscription
  useEffect(() => {
    if (!eventId) return;
    const channel = supabase
      .channel(`bulk-cascade-${eventId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "cascade_results",
          filter: `cascade_event_id=eq.${eventId}`,
        },
        (payload) => {
          const row = payload.new as {
            clone_id: string;
            status: string;
            error_message?: string;
            pr_url?: string;
            previous_sha?: string;
          };
          setProgress((prev) =>
            prev.map((p) =>
              p.clone_id === row.clone_id
                ? {
                    ...p,
                    status: row.status as CloneProgress["status"],
                    error: row.error_message,
                    pr_url: row.pr_url,
                    previous_sha: row.previous_sha,
                  }
                : p,
            ),
          );
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [eventId]);

  const fireBulk = async (targetClones?: Clone[]) => {
    const targets = targetClones ?? filteredClones;
    if (targets.length === 0) return toast.error("No clones match your filters");
    setRunning(true);
    setExpanded(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (dryRun) {
        // Dry-run: just show preview without executing
        const initialProgress: CloneProgress[] = targets.map((c) => ({
          clone_id: c.id,
          name: c.name,
          status: "queued",
        }));
        setProgress(initialProgress);
        toast.info(
          `Dry run: ${targets.length} clones would be updated. Review below, then disable dry-run to execute.`,
        );
        setRunning(false);
        return;
      }

      const { data: ev, error } = await supabase
        .from("cascade_events")
        .insert({
          trigger: "manual",
          mode: "pr",
          status: "pending",
          scope_filter: {
            scope: "filtered",
            bulk: true,
            clone_ids: targets.map((c) => c.id),
          },
          initiated_by: user?.id,
        })
        .select()
        .single();
      if (error || !ev) throw new Error(error?.message || "Failed to create cascade event");
      setEventId(ev.id);

      const initialProgress: CloneProgress[] = targets.map((c) => ({
        clone_id: c.id,
        name: c.name,
        status: "queued",
        previous_sha: c.last_synced_sha ?? undefined,
      }));
      setProgress(initialProgress);

      await supabase.from("cascade_results").insert(
        targets.map((c) => ({
          cascade_event_id: ev.id,
          clone_id: c.id,
          status: "queued" as const,
          previous_sha: c.last_synced_sha,
        })),
      );

      await supabase.from("audit_log").insert({
        action: "cascade.bulk_fired",
        entity_type: "cascade_event",
        entity_id: ev.id,
        actor_user_id: user?.id,
        metadata: { clone_count: targets.length, mode: "pr" },
      });

      toast.info(`Bulk cascade started — ${targets.length} clones queued`);

      const res = await runCascadeFn({ data: { cascadeEventId: ev.id } });
      if (!res.ok) {
        toast.error(res.error);
      } else {
        toast.success(
          `Bulk cascade complete: ${res.counts.succeeded} succeeded, ${res.counts.failed} failed`,
        );
      }

      // Refresh progress from DB
      const { data: results } = await supabase
        .from("cascade_results")
        .select("clone_id, status, error_message, pr_url, previous_sha")
        .eq("cascade_event_id", ev.id);

      if (results) {
        setProgress((prev) =>
          prev.map((p) => {
            const r = results.find((x: { clone_id: string }) => x.clone_id === p.clone_id);
            if (!r) return p;
            return {
              ...p,
              status: r.status as CloneProgress["status"],
              error: r.error_message ?? undefined,
              pr_url: r.pr_url ?? undefined,
              previous_sha: r.previous_sha ?? undefined,
            };
          }),
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bulk cascade failed");
    } finally {
      setRunning(false);
    }
  };

  const retryFailed = async () => {
    if (!eventId || failedClones.length === 0) return;
    const failedCloneData = clones.filter((c) =>
      failedClones.some((f) => f.clone_id === c.id),
    );
    // Reset failed statuses to queued in UI
    setProgress((prev) =>
      prev.map((p) => (p.status === "failed" ? { ...p, status: "queued", error: undefined } : p)),
    );
    // Update DB rows to queued
    for (const fc of failedClones) {
      await supabase
        .from("cascade_results")
        .update({ status: "queued", error_message: null })
        .eq("cascade_event_id", eventId)
        .eq("clone_id", fc.clone_id);
    }
    toast.info(`Retrying ${failedCloneData.length} failed clones…`);
    // Re-run cascade engine (it will pick up queued rows)
    try {
      const res = await runCascadeFn({ data: { cascadeEventId: eventId } });
      if (!res.ok) toast.error(res.error);
      else toast.success(`Retry complete: ${res.counts.succeeded} succeeded, ${res.counts.failed} failed`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Retry failed");
    }
    // Refresh
    const { data: results } = await supabase
      .from("cascade_results")
      .select("clone_id, status, error_message, pr_url, previous_sha")
      .eq("cascade_event_id", eventId);
    if (results) {
      setProgress((prev) =>
        prev.map((p) => {
          const r = results.find((x: { clone_id: string }) => x.clone_id === p.clone_id);
          if (!r) return p;
          return {
            ...p,
            status: r.status as CloneProgress["status"],
            error: r.error_message ?? undefined,
            pr_url: r.pr_url ?? undefined,
            previous_sha: r.previous_sha ?? undefined,
          };
        }),
      );
    }
  };

  const rollbackClone = async (cloneId: string, previousSha: string) => {
    toast.info("Rolling back clone…");
    // Record rollback intent in audit_log
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase.from("audit_log").insert({
      action: "cascade.rollback",
      entity_type: "clone",
      entity_id: cloneId,
      actor_user_id: user?.id,
      metadata: { previous_sha: previousSha, cascade_event_id: eventId },
    });
    // Update the clone's last_synced_sha back to previous
    await supabase
      .from("clones")
      .update({ last_synced_sha: previousSha })
      .eq("id", cloneId);
    setProgress((prev) =>
      prev.map((p) =>
        p.clone_id === cloneId ? { ...p, status: "skipped", error: "Rolled back" } : p,
      ),
    );
    toast.success("Clone rolled back to previous version");
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Rocket className="h-4 w-4" /> Bulk cascade
            </CardTitle>
            <CardDescription>
              Push prime codebase upgrades to filtered clones. Track per-clone progress and failures
              in real time.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
              className={cn(showFilters && "bg-muted")}
            >
              <Filter className="mr-1.5 h-3.5 w-3.5" />
              Filters
            </Button>
            <Button
              variant={dryRun ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setDryRun(!dryRun)}
            >
              <Eye className="mr-1.5 h-3.5 w-3.5" />
              {dryRun ? "Dry-run ON" : "Dry-run"}
            </Button>
            <Button onClick={() => fireBulk()} disabled={running || filteredClones.length === 0} size="sm">
              {running ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Waves className="mr-2 h-3.5 w-3.5" />
              )}
              {running
                ? "Running…"
                : dryRun
                  ? `Preview (${filteredClones.length})`
                  : `Cascade (${filteredClones.length})`}
            </Button>
          </div>
        </div>
      </CardHeader>

      {/* Filters */}
      {showFilters && (
        <CardContent className="border-t border-border pt-4 pb-0">
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Clone name
              </label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search clones…"
                  value={nameFilter}
                  onChange={(e) => setNameFilter(e.target.value)}
                  className="pl-8 h-9 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Sync status
              </label>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as SyncFilter)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="synced">Synced</SelectItem>
                  <SelectItem value="behind">Behind</SelectItem>
                  <SelectItem value="diverged">Diverged</SelectItem>
                  <SelectItem value="unknown">Unknown</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Last updated
              </label>
              <Select value={timeFilter} onValueChange={(v) => setTimeFilter(v as TimeFilter)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any time</SelectItem>
                  <SelectItem value="24h">Last 24 hours</SelectItem>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="mt-2 mb-3 font-mono text-[10px] text-muted-foreground">
            {filteredClones.length} of {clones.length} clones match
          </div>
        </CardContent>
      )}

      {/* Dry-run preview */}
      {dryRun && progress.length > 0 && !running && (
        <CardContent className="border-t border-border pt-4">
          <div className="rounded-md border border-info/30 bg-info/5 p-3">
            <div className="flex items-center gap-2 mb-2">
              <Eye className="h-4 w-4 text-info" />
              <span className="font-mono text-xs font-semibold uppercase tracking-wider text-info">
                Dry-run preview
              </span>
            </div>
            <p className="text-xs text-muted-foreground mb-2">
              These {progress.length} clones would be updated. Disable dry-run and click Cascade to
              execute.
            </p>
            <ul className="space-y-1">
              {progress.map((p) => (
                <li
                  key={p.clone_id}
                  className="flex items-center gap-2 rounded border border-border px-2 py-1.5 text-xs"
                >
                  <div className="h-2 w-2 rounded-full bg-info" />
                  <span className="font-mono">{p.name}</span>
                  <Badge variant="outline" className="ml-auto text-[9px]">
                    will update
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      )}

      {progress.length > 0 && !dryRun && (
        <CardContent className="space-y-4">
          {/* Progress bar */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                Progress
              </div>
              <div className="flex items-center gap-3 font-mono text-[11px]">
                <span className="text-success">{succeeded} ok</span>
                {failed > 0 && <span className="text-destructive">{failed} failed</span>}
                <span className="text-muted-foreground">
                  {completed}/{total}
                </span>
              </div>
            </div>
            <Progress value={pct} className="h-2" />
          </div>

          {/* Retry failed */}
          {failed > 0 && !running && (
            <div className="flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
              <span className="font-mono text-xs text-destructive">
                {failed} clone{failed > 1 ? "s" : ""} failed
              </span>
              <Button variant="destructive" size="sm" onClick={retryFailed}>
                <RotateCcw className="mr-1.5 h-3 w-3" />
                Retry failed
              </Button>
            </div>
          )}

          {/* Toggle details */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="w-full"
          >
            {expanded ? (
              <ChevronUp className="mr-2 h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="mr-2 h-3.5 w-3.5" />
            )}
            {expanded ? "Hide details" : "Show per-clone details"}
          </Button>

          {/* Per-clone rows */}
          {expanded && (
            <ul className="space-y-1">
              {progress.map((p) => (
                <li
                  key={p.clone_id}
                  className="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2 text-sm"
                >
                  <StatusIcon status={p.status} />
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-xs font-medium truncate">{p.name}</div>
                    {p.error && (
                      <div className="font-mono text-[10px] text-destructive truncate">
                        {p.error}
                      </div>
                    )}
                    {p.pr_url && (
                      <a
                        href={p.pr_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-[10px] text-primary hover:underline"
                      >
                        View PR →
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Rollback button for failed/succeeded clones with previous_sha */}
                    {(p.status === "failed" || p.status === "succeeded") &&
                      p.previous_sha &&
                      p.error !== "Rolled back" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[10px]"
                          onClick={() => rollbackClone(p.clone_id, p.previous_sha!)}
                        >
                          <Undo2 className="mr-1 h-3 w-3" />
                          Rollback
                        </Button>
                      )}
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[9px] uppercase",
                        p.status === "succeeded" && "border-success/40 text-success",
                        p.status === "failed" && "border-destructive/40 text-destructive",
                        p.status === "running" && "border-info/40 text-info animate-pulse",
                        (p.status === "queued" || p.status === "skipped") &&
                          "border-muted text-muted-foreground",
                      )}
                    >
                      {p.status}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function StatusIcon({ status }: { status: CloneProgress["status"] }) {
  switch (status) {
    case "succeeded":
      return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />;
    case "failed":
      return <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />;
    case "running":
      return <Loader2 className="h-3.5 w-3.5 shrink-0 text-info animate-spin" />;
    default:
      return (
        <div className="h-3.5 w-3.5 shrink-0 rounded-full border border-muted-foreground/30" />
      );
  }
}
