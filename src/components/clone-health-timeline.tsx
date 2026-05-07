// 30-day uptime/probe sparkline drawn from clone_health_snapshots.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity } from "lucide-react";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";

type Bucket = { date: string; up: number; total: number; pct: number };

function bucketize(rows: Array<{ probed_at: string; payload: unknown }>): Bucket[] {
  const map = new Map<string, { up: number; total: number }>();
  for (const r of rows) {
    const date = r.probed_at.slice(0, 10);
    const status = String(((r.payload ?? {}) as Record<string, unknown>).status ?? "").toLowerCase();
    const ok = ["ok", "up", "healthy", "ready", "active"].includes(status);
    const cur = map.get(date) ?? { up: 0, total: 0 };
    cur.total += 1;
    if (ok) cur.up += 1;
    map.set(date, cur);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, up: v.up, total: v.total, pct: v.total > 0 ? Math.round((v.up / v.total) * 100) : 0 }));
}

export function CloneHealthTimeline({ cloneId }: { cloneId: string }) {
  const [series, setSeries] = useState<Bucket[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const since = new Date(Date.now() - 30 * 86400_000).toISOString();
      const { data } = await supabase
        .from("clone_health_snapshots")
        .select("probed_at, payload")
        .eq("clone_id", cloneId)
        .gte("probed_at", since)
        .order("probed_at", { ascending: true });
      if (cancelled) return;
      setSeries(bucketize((data ?? []).map((r) => ({ probed_at: r.probed_at, payload: r.payload }))));
    })();
    return () => { cancelled = true; };
  }, [cloneId]);

  if (series.length === 0) return null;
  const avg = Math.round(series.reduce((s, b) => s + b.pct, 0) / series.length);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-mono uppercase tracking-wider">
          <Activity className="h-4 w-4 text-primary" /> 30-day uptime
        </CardTitle>
        <span className="font-mono text-xs text-muted-foreground">avg {avg}%</span>
      </CardHeader>
      <CardContent>
        <div className="h-32">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series}>
              <XAxis dataKey="date" tick={{ fontSize: 10 }} hide />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} width={28} />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 11 }} />
              <Line type="monotone" dataKey="pct" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
