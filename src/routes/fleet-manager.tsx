import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/protected-route";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Bot, Activity, AlertTriangle, Sparkles, GitCommit } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useClones } from "@/lib/queries";

export const Route = createFileRoute("/fleet-manager")({
  component: () => (
    <ProtectedRoute>
      <FleetManager />
    </ProtectedRoute>
  ),
  head: () => ({ meta: [{ title: "AI Manager — Mission Control" }] }),
});

function FleetManager() {
  const { data: clones } = useClones();
  const drift = clones.filter((c) => c.sync_status === "behind");
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
        <Badge variant="outline" className="ml-auto border-success/40 text-success">
          <span className="mr-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
          background sweep active
        </Badge>
      </header>

      <div className="grid gap-3 md:grid-cols-3">
        <SignalCard icon={<Activity />} label="Sweeps last 24h" value="48" tone="info" />
        <SignalCard icon={<AlertTriangle />} label="Drift detected" value={String(drift.length)} tone="warning" />
        <SignalCard icon={<GitCommit />} label="Auto-resolved" value="12" tone="success" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-accent" /> Suggested cascades
          </CardTitle>
          <CardDescription>
            AI inspects diffs between prime and each clone and recommends when to push.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {drift.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              All clones in sync. Nothing to suggest.
            </div>
          ) : (
            <ul className="space-y-2">
              {drift.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2"
                >
                  <div>
                    <div className="font-mono text-sm">{c.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.commits_behind} commits behind prime
                    </div>
                  </div>
                  <Badge variant="outline" className="border-warning/40 text-warning">
                    cascade recommended
                  </Badge>
                </li>
              ))}
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
          <div className={`mt-2 font-mono text-3xl font-semibold ${c}`}>{value}</div>
        </div>
        <div className={`flex h-9 w-9 items-center justify-center rounded-md bg-muted ${c} [&>svg]:h-4 [&>svg]:w-4`}>
          {icon}
        </div>
      </CardContent>
    </Card>
  );
}
