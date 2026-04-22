import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Waves,
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  Rocket,
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
};

export function BulkCascadeCard() {
  const { data: clones } = useClones();
  const runCascadeFn = useServerFn(runCascade);
  const [running, setRunning] = useState(false);
  const [eventId, setEventId] = useState<string | null>(null);
  const [progress, setProgress] = useState<CloneProgress[]>([]);
  const [expanded, setExpanded] = useState(false);

  const completed = progress.filter(
    (p) => p.status === "succeeded" || p.status === "failed" || p.status === "skipped",
  ).length;
  const total = progress.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const succeeded = progress.filter((p) => p.status === "succeeded").length;
  const failed = progress.filter((p) => p.status === "failed").length;

  // Realtime subscription for cascade_results changes
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
          };
          setProgress((prev) =>
            prev.map((p) =>
              p.clone_id === row.clone_id
                ? {
                    ...p,
                    status: row.status as CloneProgress["status"],
                    error: row.error_message,
                    pr_url: row.pr_url,
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

  const fireBulk = async () => {
    if (clones.length === 0) return toast.error("No clones registered");
    setRunning(true);
    setExpanded(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();

      // Create event
      const { data: ev, error } = await supabase
        .from("cascade_events")
        .insert({
          trigger: "manual",
          mode: "pr",
          status: "pending",
          scope_filter: { scope: "all", bulk: true },
          initiated_by: user?.id,
        })
        .select()
        .single();
      if (error || !ev) throw new Error(error?.message || "Failed to create cascade event");
      setEventId(ev.id);

      // Create results for each clone
      const initialProgress: CloneProgress[] = clones.map((c) => ({
        clone_id: c.id,
        name: c.name,
        status: "queued",
      }));
      setProgress(initialProgress);

      await supabase.from("cascade_results").insert(
        clones.map((c) => ({
          cascade_event_id: ev.id,
          clone_id: c.id,
          status: "queued" as const,
        })),
      );

      // Audit log
      await supabase.from("audit_log").insert({
        action: "cascade.bulk_fired",
        entity_type: "cascade_event",
        entity_id: ev.id,
        actor_user_id: user?.id,
        metadata: { clone_count: clones.length, mode: "pr" },
      });

      toast.info(`Bulk cascade started — ${clones.length} clones queued`);

      // Run the cascade engine
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
        .select("clone_id, status, error_message, pr_url")
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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Rocket className="h-4 w-4" /> Bulk cascade
            </CardTitle>
            <CardDescription>
              Push prime codebase upgrades to all clones at once. Track per-clone progress and failures in real time.
            </CardDescription>
          </div>
          <Button onClick={fireBulk} disabled={running || clones.length === 0} size="sm">
            {running ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Waves className="mr-2 h-3.5 w-3.5" />
            )}
            {running ? "Running…" : `Cascade all (${clones.length})`}
          </Button>
        </div>
      </CardHeader>

      {progress.length > 0 && (
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
