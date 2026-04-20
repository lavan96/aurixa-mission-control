import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ProtectedRoute } from "@/components/protected-route";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  AlertTriangle,
  CircleCheck,
  CircleX,
  RefreshCw,
  Loader2,
  Sparkles,
  Zap,
  TrendingDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "@/lib/format";
import { fetchFleetHealth, type FleetHealth, type FleetHealthRow } from "@/server/fleet-health.functions";
import { fetchCloneHealth } from "@/server/clone-health.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/health")({
  component: () => (
    <ProtectedRoute>
      <FleetHealthPage />
    </ProtectedRoute>
  ),
  head: () => ({
    meta: [
      { title: "Fleet Health — Aurixa Systems Mission Control" },
      {
        name: "description",
        content:
          "Workspace-wide health: deploy uptime, drift, and cascade failures across the entire fleet.",
      },
    ],
  }),
});

function FleetHealthPage() {
  const fetchFn = useServerFn(fetchFleetHealth);
  const [data, setData] = useState<FleetHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchFn({ data: { force } });
      setData(res);
      setRefreshedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load fleet health");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = data?.totals;
  const upPct = totals && totals.total > 0 ? Math.round((totals.up / totals.total) * 100) : null;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
            workspace
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Fleet health</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live uptime + 7-day cascade & drift roll-up across every clone.
            {refreshedAt && (
              <span className="ml-2 font-mono text-xs text-muted-foreground/70">
                · loaded {formatDistanceToNow(refreshedAt.toISOString())}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => void load(false)} disabled={loading}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loading && "animate-spin")} />
            Reload (cached)
          </Button>
          <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={loading}>
            <Zap className="mr-1.5 h-3.5 w-3.5" />
            {loading ? "Probing fleet…" : "Force probe"}
          </Button>
        </div>
      </header>

      {error && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {!data && loading && (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Probing every clone & summarizing…
          </CardContent>
        </Card>
      )}

      {data && totals && (
        <>
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-5">
            <SummaryTile
              icon={<Activity />}
              label="Clones"
              value={String(totals.total)}
              detail={upPct !== null ? `${upPct}% deploys up` : "—"}
              tone="info"
            />
            <SummaryTile
              icon={<CircleCheck />}
              label="Up"
              value={String(totals.up)}
              detail={`${totals.unknown} unknown`}
              tone="success"
            />
            <SummaryTile
              icon={<CircleX />}
              label="Down"
              value={String(totals.down)}
              detail={totals.down === 0 ? "all responding" : "deploy ping failed"}
              tone={totals.down > 0 ? "destructive" : "muted"}
            />
            <SummaryTile
              icon={<Zap />}
              label="Cascade fails · 7d"
              value={String(totals.cascadeFailures7d)}
              detail={`of ${totals.cascades7d} runs`}
              tone={totals.cascadeFailures7d > 0 ? "warning" : "success"}
            />
            <SummaryTile
              icon={<TrendingDown />}
              label="Drift / behind"
              value={String(totals.openDrift + totals.behind)}
              detail={`${totals.openDrift} drift · ${totals.behind} behind`}
              tone={totals.openDrift + totals.behind > 0 ? "warning" : "success"}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Per-clone breakdown</CardTitle>
              <CardDescription>
                Sorted by risk — down deploys first, then failed cascades, then drift.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.rows.length === 0 && (
                <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No clones in the fleet yet.
                </div>
              )}
              {[...data.rows]
                .sort((a, b) => riskScore(b) - riskScore(a))
                .map((r) => (
                  <FleetRow
                    key={r.cloneId}
                    row={r}
                    onUpdated={(next) =>
                      setData((prev) =>
                        prev
                          ? {
                              ...prev,
                              rows: prev.rows.map((row) =>
                                row.cloneId === next.cloneId ? next : row,
                              ),
                            }
                          : prev,
                      )
                    }
                  />
                ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function riskScore(r: FleetHealthRow): number {
  let s = 0;
  if (r.health.uptime.status === "down") s += 100;
  if (r.health.uptime.status === "unknown") s += 5;
  s += r.health.failureCount7d * 10;
  s += r.health.driftSuggestionsOpen * 3;
  s += r.commitsBehind;
  return s;
}

function FleetRow({
  row,
  onUpdated,
}: {
  row: FleetHealthRow;
  onUpdated: (next: FleetHealthRow) => void;
}) {
  const refreshFn = useServerFn(fetchCloneHealth);
  const [refreshing, setRefreshing] = useState(false);
  const h = row.health;
  const uptimeTone =
    h.uptime.status === "up"
      ? "border-success/30"
      : h.uptime.status === "down"
        ? "border-destructive/40"
        : "border-border/60";

  const handleRefresh = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setRefreshing(true);
    try {
      const fresh = await refreshFn({ data: { cloneId: row.cloneId, force: true } });
      onUpdated({
        ...row,
        health: fresh,
        probedAt: new Date().toISOString(),
        fromCache: false,
      });
      toast.success(`${row.name} re-probed`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div
      className={cn(
        "group relative flex flex-col gap-2 rounded-md border bg-surface p-3 transition-colors hover:bg-muted/30 md:flex-row md:items-center",
        uptimeTone,
      )}
    >
      <Link
        to="/clones/$cloneId"
        params={{ cloneId: row.cloneId }}
        className="absolute inset-0 z-0 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Open clone ${row.name}`}
      />
      <div className="relative z-10 flex flex-1 items-start gap-3 min-w-0 pointer-events-none">
        <UptimeIcon status={h.uptime.status} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-mono text-sm font-medium">{row.name}</span>
            <Badge variant="outline" className={cn("font-mono text-[10px] uppercase", syncTone(row.syncStatus))}>
              {row.syncStatus}
            </Badge>
            {row.commitsBehind > 0 && (
              <Badge variant="outline" className="border-warning/40 font-mono text-[10px] uppercase text-warning">
                {row.commitsBehind} behind
              </Badge>
            )}
            {h.driftSuggestionsOpen > 0 && (
              <Badge variant="outline" className="border-warning/40 font-mono text-[10px] uppercase text-warning">
                <AlertTriangle className="mr-1 h-3 w-3" />
                {h.driftSuggestionsOpen} drift
              </Badge>
            )}
            {h.failureCount7d > 0 && (
              <Badge variant="outline" className="border-destructive/40 font-mono text-[10px] uppercase text-destructive">
                {h.failureCount7d} fail · 7d
              </Badge>
            )}
            <CacheAgeBadge probedAt={row.probedAt} fromCache={row.fromCache} />
          </div>
          {h.aiSummary && (
            <div className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
              <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-accent" />
              <span className="line-clamp-2">{h.aiSummary}</span>
            </div>
          )}
        </div>
      </div>
      <div className="relative z-10 flex shrink-0 flex-wrap items-center gap-3 text-right pointer-events-none md:flex-col md:items-end md:gap-0.5">
        <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {h.uptime.latencyMs !== null
            ? `${h.uptime.latencyMs}ms · ${h.uptime.httpStatus ?? "—"}`
            : h.deployUrl
              ? "no response"
              : "no deploy URL"}
        </div>
        <div className="font-mono text-[10px] text-muted-foreground">
          last ok ·{" "}
          {h.lastSuccessfulCascadeAt ? formatDistanceToNow(h.lastSuccessfulCascadeAt) : "—"}
        </div>
      </div>
      <div className="relative z-10 flex shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing}
          className="h-7 gap-1 px-2 font-mono text-[10px] uppercase"
          aria-label={`Re-probe ${row.name}`}
        >
          {refreshing ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          Re-probe
        </Button>
      </div>
    </div>
  );
}

function CacheAgeBadge({
  probedAt,
  fromCache,
}: {
  probedAt: string;
  fromCache: boolean;
}) {
  const ageMs = Date.now() - new Date(probedAt).getTime();
  const stale = ageMs > 5 * 60 * 1000;
  const label = fromCache ? `probed ${formatDistanceToNow(probedAt)}` : "fresh probe";
  const tone = stale
    ? "border-warning/40 text-warning"
    : fromCache
      ? "border-border text-muted-foreground"
      : "border-success/40 text-success";
  return (
    <Badge variant="outline" className={cn("font-mono text-[10px] uppercase", tone)}>
      {label}
    </Badge>
  );
}

function UptimeIcon({ status }: { status: FleetHealthRow["health"]["uptime"]["status"] }) {
  const cls = "h-4 w-4 shrink-0 mt-0.5";
  switch (status) {
    case "up":
      return <CircleCheck className={cn(cls, "text-success")} />;
    case "down":
      return <CircleX className={cn(cls, "text-destructive")} />;
    case "unknown":
      return <Activity className={cn(cls, "text-muted-foreground")} />;
  }
}

function syncTone(s: FleetHealthRow["syncStatus"]) {
  switch (s) {
    case "in_sync":
      return "border-success/40 text-success";
    case "behind":
      return "border-warning/40 text-warning";
    case "cascading":
      return "border-info/40 text-info";
    case "failed":
      return "border-destructive/40 text-destructive";
    default:
      return "border-border text-muted-foreground";
  }
}

function SummaryTile({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  tone: "info" | "success" | "warning" | "destructive" | "muted";
}) {
  const map = {
    info: "text-info",
    success: "text-success",
    warning: "text-warning",
    destructive: "text-destructive",
    muted: "text-muted-foreground",
  };
  return (
    <Card>
      <CardContent className="p-4">
        <div className={cn("mb-1 flex items-center gap-1.5 [&>svg]:h-3.5 [&>svg]:w-3.5", map[tone])}>
          {icon}
          <span className="font-mono text-[10px] uppercase tracking-wider">{label}</span>
        </div>
        <div className={cn("font-mono text-2xl font-semibold", map[tone])}>{value}</div>
        <div className="font-mono text-[10px] text-muted-foreground">{detail}</div>
      </CardContent>
    </Card>
  );
}
