import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/protected-route";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Bot, Activity, AlertTriangle, Sparkles, GitCommit, RefreshCw, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useClones } from "@/lib/queries";
import { useServerFn } from "@tanstack/react-start";
import { triggerFleetDriftScan } from "@/server/fleet-drift.functions";
import { runCascade } from "@/server/cascade-engine.functions";
import { useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNow } from "@/lib/format";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type CascadeMode = Database["public"]["Enums"]["cascade_mode"];

export const Route = createFileRoute("/fleet-manager")({
  component: () => (
    <ProtectedRoute>
      <FleetManager />
    </ProtectedRoute>
  ),
  head: () => ({ meta: [{ title: "AI Manager — Mission Control" }] }),
});

type DriftSuggestion = {
  severity: "low" | "medium" | "high";
  title: string;
  rationale: string;
  recommended_action: "cascade_pr" | "cascade_auto_merge" | "notify" | "review";
};

function FleetManager() {
  const { data: clones, refresh } = useClones();
  const drift = clones.filter((c) => c.sync_status === "behind" || c.sync_status === "failed");
  const [scanning, setScanning] = useState(false);
  const [applyingKey, setApplyingKey] = useState<string | null>(null);
  const scanFn = useServerFn(triggerFleetDriftScan);
  const cascadeFn = useServerFn(runCascade);
  const navigate = useNavigate();

  const lastScan = clones
    .map((c) => c.last_drift_check_at)
    .filter(Boolean)
    .sort()
    .at(-1) as string | undefined;

  const runScan = async () => {
    setScanning(true);
    try {
      const res = await scanFn();
      if (!res.ok) toast.error(res.error);
      else toast.success(`Scanned ${res.scanned} clones — ${res.updated} updated`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  const applySuggestion = async (
    cloneId: string,
    cloneName: string,
    suggestionIndex: number,
    action: DriftSuggestion["recommended_action"],
  ) => {
    const key = `${cloneId}:${suggestionIndex}`;
    const mode: CascadeMode | null =
      action === "cascade_pr"
        ? "pr"
        : action === "cascade_auto_merge"
          ? "auto_merge"
          : action === "notify"
            ? "notify"
            : null;
    if (!mode) {
      toast.info("This suggestion is review-only — no cascade to apply.");
      return;
    }

    setApplyingKey(key);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: ev, error } = await supabase
        .from("cascade_events")
        .insert({
          trigger: "manual",
          mode,
          status: "pending",
          scope_filter: { scope: "selected", clone_ids: [cloneId], source: "drift_suggestion" },
          initiated_by: user?.id,
        })
        .select()
        .single();
      if (error || !ev) throw new Error(error?.message ?? "Failed to create cascade");

      const { error: insErr } = await supabase
        .from("cascade_results")
        .insert({ cascade_event_id: ev.id, clone_id: cloneId, status: "queued" });
      if (insErr) throw new Error(insErr.message);

      toast.info(`Applying ${mode.replace("_", " ")} to ${cloneName}…`);
      const res = await cascadeFn({ data: { cascadeEventId: ev.id } });
      if (!res.ok) {
        toast.error(res.error);
      } else {
        toast.success(`Cascade ${res.status} for ${cloneName}`);
        navigate({ to: "/cascades/$eventId", params: { eventId: ev.id } });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Apply failed");
    } finally {
      setApplyingKey(null);
      refresh();
    }
  };
    (n, c) => n + ((c.drift_suggestions as DriftSuggestion[] | null)?.length ?? 0),
    0,
  );

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/15 ring-1 ring-primary/40">
          <Bot className="h-5 w-5 text-primary" />
        </div>
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
            ai
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Fleet Manager</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge variant="outline" className="border-success/40 text-success">
            <span className="mr-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
            background sweep active
          </Badge>
          <Button size="sm" onClick={runScan} disabled={scanning}>
            <RefreshCw className={cn("mr-2 h-3.5 w-3.5", scanning && "animate-spin")} />
            {scanning ? "Scanning…" : "Scan now"}
          </Button>
        </div>
      </header>

      <div className="grid gap-3 md:grid-cols-3">
        <SignalCard
          icon={<Activity />}
          label="Last sweep"
          value={lastScan ? formatDistanceToNow(lastScan) : "—"}
          tone="info"
        />
        <SignalCard
          icon={<AlertTriangle />}
          label="Drift detected"
          value={String(drift.length)}
          tone="warning"
        />
        <SignalCard
          icon={<GitCommit />}
          label="AI suggestions"
          value={String(totalSuggestions)}
          tone="success"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-accent" /> Suggested cascades
          </CardTitle>
          <CardDescription>
            AI inspects each clone vs prime and recommends concrete next actions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {drift.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              All clones in sync. Nothing to suggest.
            </div>
          ) : (
            <ul className="space-y-3">
              {drift.map((c) => {
                const sugg = (c.drift_suggestions as DriftSuggestion[] | null) ?? [];
                return (
                  <li
                    key={c.id}
                    className="rounded-md border border-border bg-surface p-3"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-mono text-sm">{c.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {c.commits_behind} commits behind prime
                          {c.last_drift_check_at && (
                            <> · checked {formatDistanceToNow(c.last_drift_check_at)}</>
                          )}
                        </div>
                      </div>
                      <Badge variant="outline" className="border-warning/40 text-warning">
                        {c.sync_status}
                      </Badge>
                    </div>
                    {sugg.length > 0 && (
                      <ul className="mt-3 space-y-1.5 border-t border-border/60 pt-2">
                        {sugg.map((s, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs">
                            <Badge
                              variant="outline"
                              className={cn(
                                "mt-0.5 text-[9px] uppercase",
                                s.severity === "high"
                                  ? "border-destructive/40 text-destructive"
                                  : s.severity === "medium"
                                    ? "border-warning/40 text-warning"
                                    : "border-muted text-muted-foreground",
                              )}
                            >
                              {s.severity}
                            </Badge>
                            <div className="flex-1">
                              <div className="font-mono font-medium text-foreground">
                                {s.title}
                              </div>
                              <div className="text-muted-foreground">{s.rationale}</div>
                              <div className="mt-0.5 font-mono text-[10px] text-accent">
                                → {s.recommended_action.replace("_", " ")}
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SignalCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "info" | "warning" | "success";
}) {
  const c = { info: "text-info", warning: "text-warning", success: "text-success" }[tone];
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {label}
          </div>
          <div className={`mt-2 font-mono text-2xl font-semibold ${c}`}>{value}</div>
        </div>
        <div className={`flex h-9 w-9 items-center justify-center rounded-md bg-muted ${c} [&>svg]:h-4 [&>svg]:w-4`}>
          {icon}
        </div>
      </CardContent>
    </Card>
  );
}
