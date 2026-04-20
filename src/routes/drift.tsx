import { createFileRoute, Link } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/protected-route";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sparkles, AlertTriangle, CheckCircle2, ExternalLink } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { applyDriftSuggestion, dismissDriftSuggestion } from "@/server/drift-suggestions.functions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "@/lib/format";

export const Route = createFileRoute("/drift")({
  component: () => (
    <ProtectedRoute>
      <DriftDashboard />
    </ProtectedRoute>
  ),
  head: () => ({ meta: [{ title: "Fleet drift — Aurixa Systems Mission Control" }] }),
});

type Suggestion = {
  id: string;
  status: "open" | "applied" | "dismissed";
  recommended_mode: "pr" | "auto_merge" | "notify";
  summary: string;
  files: string[];
  risk: "low" | "medium" | "high";
  category: string;
  rationale: string;
  created_at: string;
  applied_event_id?: string | null;
};

type Row = {
  cloneId: string;
  cloneName: string;
  suggestion: Suggestion;
};

function DriftDashboard() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const apply = useServerFn(applyDriftSuggestion);
  const dismiss = useServerFn(dismissDriftSuggestion);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "low" | "medium" | "high">("all");

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("clones")
      .select("id, name, drift_suggestions");
    const out: Row[] = [];
    for (const c of data ?? []) {
      const sugs = (c.drift_suggestions as unknown as Suggestion[] | null) ?? [];
      for (const s of sugs) {
        if (s.status === "open") out.push({ cloneId: c.id, cloneName: c.name, suggestion: s });
      }
    }
    out.sort((a, b) => {
      const rank = { high: 0, medium: 1, low: 2 } as const;
      return rank[a.suggestion.risk] - rank[b.suggestion.risk];
    });
    setRows(out);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const filtered = filter === "all" ? rows : rows.filter((r) => r.suggestion.risk === filter);

  const onApply = async (r: Row) => {
    setBusy(r.suggestion.id);
    const res = await apply({ data: { cloneId: r.cloneId, suggestionId: r.suggestion.id } });
    if (!res.ok) toast.error(res.error);
    else toast.success(`Applied · cascade ${res.cascade_event_id.slice(0, 8)}`);
    setBusy(null);
    refresh();
  };

  const onDismiss = async (r: Row) => {
    setBusy(r.suggestion.id);
    await dismiss({ data: { cloneId: r.cloneId, suggestionId: r.suggestion.id } });
    setBusy(null);
    refresh();
  };

  const groups: Record<string, Row[]> = {};
  for (const r of filtered) (groups[r.suggestion.category] ??= []).push(r);

  return (
    <div className="space-y-6">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
          fleet-wide
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Drift dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          All open AI suggestions across the fleet, grouped by category.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {(["all", "high", "medium", "low"] as const).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
            {f === "all" ? `All (${rows.length})` : `${f} (${rows.filter((r) => r.suggestion.risk === f).length})`}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="font-mono text-sm text-muted-foreground">loading…</div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            <Sparkles className="mx-auto mb-2 h-8 w-8 opacity-50" />
            No open suggestions. Run drift analysis on individual clones to populate this dashboard.
          </CardContent>
        </Card>
      ) : (
        Object.entries(groups).map(([cat, items]) => (
          <Card key={cat}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Badge variant="outline" className="font-mono uppercase">{cat}</Badge>
                <span className="font-mono text-xs text-muted-foreground">{items.length} open</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {items.map((r) => (
                <div
                  key={`${r.cloneId}:${r.suggestion.id}`}
                  className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3 md:flex-row md:items-start md:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <RiskIcon risk={r.suggestion.risk} />
                      <span className="text-sm font-medium">{r.suggestion.summary}</span>
                      <Badge variant="outline" className={cn("text-[10px] uppercase", riskTone(r.suggestion.risk))}>
                        {r.suggestion.risk}
                      </Badge>
                      <Link
                        to="/clones/$cloneId"
                        params={{ cloneId: r.cloneId }}
                        className="font-mono text-[11px] text-muted-foreground hover:text-primary"
                      >
                        {r.cloneName} <ExternalLink className="inline h-3 w-3" />
                      </Link>
                    </div>
                    <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                      {r.suggestion.files.slice(0, 3).join(" · ")}
                      {r.suggestion.files.length > 3 && ` · +${r.suggestion.files.length - 3}`}
                      {" · "}
                      {formatDistanceToNow(r.suggestion.created_at)}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" disabled={busy === r.suggestion.id} onClick={() => onApply(r)}>
                      Apply
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy === r.suggestion.id} onClick={() => onDismiss(r)}>
                      Dismiss
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

function RiskIcon({ risk }: { risk: "low" | "medium" | "high" }) {
  if (risk === "low") return <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />;
  return <AlertTriangle className={cn("h-4 w-4 shrink-0", risk === "high" ? "text-destructive" : "text-warning")} />;
}

function riskTone(r: "low" | "medium" | "high") {
  if (r === "high") return "border-destructive/40 text-destructive";
  if (r === "medium") return "border-warning/40 text-warning";
  return "border-success/40 text-success";
}
