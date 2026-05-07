import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ProtectedRoute } from "@/components/protected-route";
import { RouteError } from "@/components/route-error";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart3, Activity, Sparkles, Bell, Bot } from "lucide-react";
import { getFleetMetrics } from "@/server/metrics.functions";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";

export const Route = createFileRoute("/metrics")({
  errorComponent: RouteError,
  component: () => (
    <ProtectedRoute>
      <MetricsPage />
    </ProtectedRoute>
  ),
  head: () => ({ meta: [{ title: "Metrics — Aurixa Systems Mission Control" }] }),
});

function MetricsPage() {
  const fn = useServerFn(getFleetMetrics);
  const q = useQuery({ queryKey: ["fleet-metrics"], queryFn: () => fn(), refetchInterval: 60_000 });
  const m = q.data?.summary;

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/15 ring-1 ring-primary/40">
          <BarChart3 className="h-5 w-5 text-primary" />
        </div>
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">observability</p>
          <h1 className="text-3xl font-semibold tracking-tight">Fleet Metrics</h1>
          <p className="text-sm text-muted-foreground">30-day rolling snapshot of cascades, drift, AI usage, and push delivery.</p>
        </div>
      </header>

      <div className="grid gap-3 md:grid-cols-4">
        <Stat label="Clones" value={m?.clones_total ?? 0} icon={Activity} />
        <Stat label="Drifted" value={m?.clones_drifted ?? 0} icon={Sparkles} accent="warning" />
        <Stat label="CF wrapped" value={m?.clones_cf ?? 0} icon={BarChart3} />
        <Stat label="Cascades 30d" value={m?.cascades_30d ?? 0} icon={Activity} />
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Stat label="Cascade success" value={m ? `${Math.round(m.cascade_success_rate * 100)}%` : "—"} accent={m && m.cascade_success_rate > 0.9 ? "success" : "warning"} />
        <Stat label="Cascades failed" value={m?.cascades_failed ?? 0} accent="warning" />
        <Stat label="Drift alerts" value={m?.drift_alerts_30d ?? 0} />
        <Stat label="AI tokens" value={(m?.ai_tokens_30d ?? 0).toLocaleString()} icon={Bot} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4" />Cascades / day</CardTitle>
          <CardDescription>Activity over the last 30 days</CardDescription>
        </CardHeader>
        <CardContent className="h-64">
          {q.data?.cascades_by_day?.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={q.data.cascades_by_day}>
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Line type="monotone" dataKey="count" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : <Empty />}
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Sparkles className="h-4 w-4" />Drift alerts / day</CardTitle>
          </CardHeader>
          <CardContent className="h-48">
            {q.data?.drift_by_day?.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={q.data.drift_by_day}>
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="count" stroke="hsl(var(--warning))" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : <Empty />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Bot className="h-4 w-4" />AI calls / day</CardTitle>
          </CardHeader>
          <CardContent className="h-48">
            {q.data?.ai_by_day?.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={q.data.ai_by_day}>
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="count" stroke="hsl(var(--accent))" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : <Empty />}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Bell className="h-4 w-4" />Push delivery</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-6">
          <div>
            <div className="font-mono text-[10px] uppercase text-muted-foreground">Success rate (30d)</div>
            <div className="text-2xl font-semibold">{m?.push_success_rate != null ? `${Math.round(m.push_success_rate * 100)}%` : "—"}</div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase text-muted-foreground">Total deliveries</div>
            <div className="text-2xl font-semibold">{(m?.push_total_30d ?? 0).toLocaleString()}</div>
          </div>
          {m?.push_total_30d ? <Badge className="bg-success/15 text-success">tracked</Badge> : <Badge variant="outline">no data</Badge>}
        </CardContent>
      </Card>
    </div>
  );
}

function Empty() {
  return <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No data yet</div>;
}

function Stat({ label, value, icon: Icon, accent }: { label: string; value: string | number; icon?: any; accent?: "warning" | "success" }) {
  const color = accent === "warning" ? "text-warning" : accent === "success" ? "text-success" : "";
  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-2 flex items-center gap-2">
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        </div>
        <div className={`text-2xl font-semibold ${color}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
