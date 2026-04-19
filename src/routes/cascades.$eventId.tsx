import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/protected-route";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Waves,
  ExternalLink,
  RefreshCw,
  GitMerge,
  Send,
  Bell,
  CircleDot,
  Loader2,
  CheckCircle2,
  XCircle,
  SkipForward,
  GitPullRequest,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "@/lib/format";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { runCascade } from "@/server/cascade-engine.functions";

type CascadeEvent = Database["public"]["Tables"]["cascade_events"]["Row"];
type CascadeResult = Database["public"]["Tables"]["cascade_results"]["Row"];
type Clone = Database["public"]["Tables"]["clones"]["Row"];
type ResultWithClone = CascadeResult & { clone?: Clone | null };

export const Route = createFileRoute("/cascades/$eventId")({
  component: () => (
    <ProtectedRoute>
      <CascadeDetailPage />
    </ProtectedRoute>
  ),
  head: () => ({ meta: [{ title: "Cascade — Mission Control" }] }),
});

function CascadeDetailPage() {
  const { eventId } = Route.useParams();
  const router = useRouter();
  const [event, setEvent] = useState<CascadeEvent | null>(null);
  const [results, setResults] = useState<ResultWithClone[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const runCascadeFn = useServerFn(runCascade);

  const refresh = useCallback(async () => {
    const [{ data: ev }, { data: res }] = await Promise.all([
      supabase.from("cascade_events").select("*").eq("id", eventId).maybeSingle(),
      supabase
        .from("cascade_results")
        .select("*, clone:clones(*)")
        .eq("cascade_event_id", eventId)
        .order("created_at", { ascending: true }),
    ]);
    setEvent(ev ?? null);
    setResults((res as ResultWithClone[] | null) ?? []);
    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Realtime subscription on cascade_results scoped to this event
  useEffect(() => {
    const channel = supabase
      .channel(`cascade-results-${eventId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "cascade_results",
          filter: `cascade_event_id=eq.${eventId}`,
        },
        () => refresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "cascade_events",
          filter: `id=eq.${eventId}`,
        },
        (payload) => setEvent(payload.new as CascadeEvent),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, refresh]);

  const retryFailed = async () => {
    if (!event) return;
    const failedIds = results.filter((r) => r.status === "failed").map((r) => r.id);
    if (failedIds.length === 0) return toast.info("No failed clones to retry");

    setRetrying(true);
    // Reset failed rows to queued
    const { error } = await supabase
      .from("cascade_results")
      .update({
        status: "queued",
        error_message: null,
        started_at: null,
        completed_at: null,
      })
      .in("id", failedIds);

    if (error) {
      toast.error(error.message);
      setRetrying(false);
      return;
    }

    // Reopen the event
    await supabase
      .from("cascade_events")
      .update({ status: "pending", completed_at: null })
      .eq("id", event.id);

    toast.info(`Retrying ${failedIds.length} clone(s)…`);
    try {
      const res = await runCascadeFn({ data: { cascadeEventId: event.id } });
      if (!res.ok) toast.error(res.error);
      else toast.success(`Retry ${res.status}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Retry failed");
    }
    setRetrying(false);
    refresh();
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading cascade…
      </div>
    );
  }

  if (!event) {
    return (
      <div className="space-y-3">
        <Link to="/cascades" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back to cascades
        </Link>
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Cascade event not found
          </CardContent>
        </Card>
      </div>
    );
  }

  const counts = {
    queued: results.filter((r) => r.status === "queued").length,
    pushing: results.filter((r) => r.status === "pushing").length,
    succeeded: results.filter((r) => r.status === "succeeded").length,
    pr_opened: results.filter((r) => r.status === "pr_opened").length,
    failed: results.filter((r) => r.status === "failed").length,
    skipped: results.filter((r) => r.status === "skipped").length,
  };
  const failedCount = counts.failed;
  const inFlight = event.status === "running" || event.status === "pending";

  return (
    <div className="space-y-6">
      <Link to="/cascades" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back to cascades
      </Link>

      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-info/15 text-info">
            <ModeIcon mode={event.mode} />
          </div>
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
              cascade · {event.trigger}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              {event.mode.replace("_", " ")} cascade
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className={cn("text-[10px] uppercase", statusTone(event.status))}>
                {event.status}
              </Badge>
              {event.source_sha && (
                <code className="font-mono">prime@{event.source_sha.slice(0, 7)}</code>
              )}
              <span>· started {formatDistanceToNow(event.created_at)}</span>
              {event.completed_at && (
                <span>· finished {formatDistanceToNow(event.completed_at)}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => router.invalidate()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
          </Button>
          {failedCount > 0 && !inFlight && (
            <Button size="sm" onClick={retryFailed} disabled={retrying}>
              <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", retrying && "animate-spin")} />
              Retry {failedCount} failed
            </Button>
          )}
        </div>
      </header>

      {event.summary && (
        <Card className="border-border/80">
          <CardContent className="p-4 font-mono text-xs text-muted-foreground">
            {event.summary}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-2 md:grid-cols-6">
        <CountTile label="Queued" value={counts.queued} icon={<CircleDot />} tone="muted" />
        <CountTile label="Pushing" value={counts.pushing} icon={<Loader2 className="animate-spin" />} tone="info" />
        <CountTile label="Merged" value={counts.succeeded} icon={<CheckCircle2 />} tone="success" />
        <CountTile label="PRs" value={counts.pr_opened} icon={<GitPullRequest />} tone="accent" />
        <CountTile label="Failed" value={counts.failed} icon={<XCircle />} tone="destructive" />
        <CountTile label="Skipped" value={counts.skipped} icon={<SkipForward />} tone="muted" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Per-clone results</CardTitle>
          <CardDescription>
            Live updates via Realtime — no refresh needed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {results.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No clones queued for this cascade.
            </div>
          ) : (
            results.map((r) => <ResultRow key={r.id} result={r} />)
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ResultRow({ result }: { result: ResultWithClone }) {
  const clone = result.clone;
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border/80 bg-surface p-3 md:flex-row md:items-center">
      <div className="flex flex-1 items-center gap-3 min-w-0">
        <ResultStatusIcon status={result.status} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-sm font-medium">
              {clone?.name ?? "Unknown clone"}
            </span>
            <Badge
              variant="outline"
              className={cn("shrink-0 text-[10px] uppercase", resultTone(result.status))}
            >
              {result.status.replace("_", " ")}
            </Badge>
          </div>
          {clone && (
            <div className="truncate font-mono text-[11px] text-muted-foreground">
              {clone.github_owner}/{clone.github_repo}
            </div>
          )}
          {result.diff_summary && (
            <div className="mt-1 text-xs text-muted-foreground">{result.diff_summary}</div>
          )}
          {result.error_message && (
            <div className="mt-1 font-mono text-xs text-destructive">{result.error_message}</div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 md:flex-col md:items-end">
        <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {result.files_changed} file{result.files_changed === 1 ? "" : "s"}
        </div>
        {result.commit_sha && (
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
            {result.commit_sha.slice(0, 7)}
          </code>
        )}
        {result.pr_url && (
          <a
            href={result.pr_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-mono text-[11px] text-accent hover:underline"
          >
            View PR <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}

function ResultStatusIcon({ status }: { status: CascadeResult["status"] }) {
  const cls = "h-4 w-4 shrink-0";
  switch (status) {
    case "queued":
      return <CircleDot className={cn(cls, "text-muted-foreground")} />;
    case "pushing":
      return <Loader2 className={cn(cls, "animate-spin text-info")} />;
    case "succeeded":
      return <CheckCircle2 className={cn(cls, "text-success")} />;
    case "pr_opened":
      return <GitPullRequest className={cn(cls, "text-accent")} />;
    case "failed":
      return <XCircle className={cn(cls, "text-destructive")} />;
    case "skipped":
      return <SkipForward className={cn(cls, "text-muted-foreground")} />;
  }
}

function CountTile({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: "info" | "success" | "destructive" | "muted" | "accent";
}) {
  const map = {
    info: "text-info",
    success: "text-success",
    destructive: "text-destructive",
    muted: "text-muted-foreground",
    accent: "text-accent",
  };
  return (
    <div className="rounded-md border border-border/80 bg-card p-3">
      <div className={cn("mb-1 flex items-center gap-1.5 [&>svg]:h-3.5 [&>svg]:w-3.5", map[tone])}>
        {icon}
        <span className="font-mono text-[10px] uppercase tracking-wider">{label}</span>
      </div>
      <div className={cn("font-mono text-2xl font-semibold", map[tone])}>{value}</div>
    </div>
  );
}

function ModeIcon({ mode }: { mode: CascadeEvent["mode"] }) {
  switch (mode) {
    case "pr":
      return <GitMerge className="h-5 w-5" />;
    case "auto_merge":
      return <Send className="h-5 w-5" />;
    case "notify":
      return <Bell className="h-5 w-5" />;
  }
}

function statusTone(s: CascadeEvent["status"]) {
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

function resultTone(s: CascadeResult["status"]) {
  switch (s) {
    case "succeeded":
      return "border-success/40 text-success";
    case "pr_opened":
      return "border-accent/40 text-accent";
    case "failed":
      return "border-destructive/40 text-destructive";
    case "pushing":
      return "border-info/40 text-info";
    case "skipped":
      return "border-muted text-muted-foreground";
    default:
      return "border-border text-muted-foreground";
  }
}
