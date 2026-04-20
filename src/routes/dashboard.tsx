import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ProtectedRoute } from "@/components/protected-route";
import { useClones, usePrimeConfig } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { StatusPill } from "@/components/status-pill";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  GitBranch,
  ExternalLink,
  Github,
  Plus,
  Search,
  Shield,
  Sparkles,
  Waves,
  Zap,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDistanceToNow } from "@/lib/format";
import { CloneGridSkeleton } from "@/components/list-skeletons";
import { EmptyState } from "@/components/empty-state";

export const Route = createFileRoute("/dashboard")({
  component: () => (
    <ProtectedRoute>
      <Dashboard />
    </ProtectedRoute>
  ),
  head: () => ({ meta: [{ title: "Fleet — Aurixa Systems Mission Control" }] }),
});

function Dashboard() {
  const { data: clones, loading } = useClones();
  const { data: prime } = usePrimeConfig();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | "in_sync" | "behind" | "failed" | "ai">("all");

  const openSuggestionsCount = (c: (typeof clones)[number]) => {
    const sugg = (c.drift_suggestions as unknown as Array<{ status?: string }> | null) ?? [];
    return sugg.filter((s) => (s?.status ?? "open") === "open").length;
  };

  const filtered = useMemo(() => {
    return clones.filter((c) => {
      const matchQ =
        !q ||
        c.name.toLowerCase().includes(q.toLowerCase()) ||
        c.tags?.some((t) => t.toLowerCase().includes(q.toLowerCase()));
      const matchF =
        filter === "all" ||
        (filter === "ai" ? openSuggestionsCount(c) > 0 : c.sync_status === filter);
      return matchQ && matchF;
    });
  }, [clones, q, filter]);

  const stats = useMemo(() => {
    return {
      total: clones.length,
      in_sync: clones.filter((c) => c.sync_status === "in_sync").length,
      behind: clones.filter((c) => c.sync_status === "behind").length,
      failed: clones.filter((c) => c.sync_status === "failed").length,
      ai_open: clones.reduce((acc, c) => acc + openSuggestionsCount(c), 0),
      ai_clones: clones.filter((c) => openSuggestionsCount(c) > 0).length,
    };
  }, [clones]);

  const toggle = (id: string) => {
    const n = new Set(selected);
    n.has(id) ? n.delete(id) : n.add(id);
    setSelected(n);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
            fleet overview
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Aurixa Systems Mission Control</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {prime ? (
              <>
                Prime:{" "}
                <span className="font-mono text-foreground">
                  {prime.github_owner}/{prime.github_repo}
                </span>{" "}
                · branch <span className="font-mono">{prime.default_branch}</span>
              </>
            ) : (
              <>
                No prime repo configured.{" "}
                <Link to="/settings" className="text-primary underline-offset-4 hover:underline">
                  Set it up
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/cascades">
            <Button variant="outline">
              <Waves className="mr-2 h-4 w-4" /> New cascade
            </Button>
          </Link>
          <Link to="/clones/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" /> New clone
            </Button>
          </Link>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Clones" value={stats.total} icon={<GitBranch className="h-4 w-4" />} />
        <StatCard
          label="In sync"
          value={stats.in_sync}
          tone="success"
          icon={<Zap className="h-4 w-4" />}
        />
        <StatCard
          label="Behind"
          value={stats.behind}
          tone="warning"
          icon={<Waves className="h-4 w-4" />}
        />
        <StatCard
          label="Failed"
          value={stats.failed}
          tone="destructive"
          icon={<Shield className="h-4 w-4" />}
        />
      </section>

      <section className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="search by name or tag…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9 font-mono text-sm"
          />
        </div>
        <div className="flex gap-1 rounded-md border border-border bg-surface p-1">
          {(["all", "in_sync", "behind", "failed"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`rounded px-3 py-1 font-mono text-[11px] uppercase tracking-wider transition-colors ${
                filter === k
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {k.replace("_", " ")}
            </button>
          ))}
        </div>
        {selected.size > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <Badge variant="secondary" className="font-mono">
              {selected.size} selected
            </Badge>
            <Button size="sm" variant="outline">
              <Waves className="mr-1.5 h-3.5 w-3.5" /> Cascade selected
            </Button>
          </div>
        )}
      </section>

      {loading ? (
        <CloneGridSkeleton count={4} />
      ) : filtered.length === 0 ? (
        clones.length === 0 ? (
          <DashboardEmpty />
        ) : (
          <EmptyState
            icon={<Search />}
            title="No clones match"
            description="Try clearing the search or switching the filter to see more clones."
          />
        )
      ) : (
        <section className="grid gap-3 lg:grid-cols-2">
          {filtered.map((c) => (
            <Card key={c.id} className="border-border/80 bg-card transition-colors hover:border-primary/40">
              <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 p-5 pb-3">
                <div className="flex items-start gap-3">
                  <Checkbox
                    checked={selected.has(c.id)}
                    onCheckedChange={() => toggle(c.id)}
                    className="mt-1.5"
                  />
                  <div>
                    <Link
                      to="/clones/$cloneId"
                      params={{ cloneId: c.id }}
                      className="font-semibold leading-tight hover:text-primary"
                    >
                      {c.name}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <Badge variant="outline" className="font-mono text-[10px] uppercase">
                        {c.provisioning_method}
                      </Badge>
                      {c.cloudflare_enabled && (
                        <Tooltip>
                          <TooltipTrigger>
                            <Badge variant="outline" className="border-info/40 text-info">
                              <Shield className="h-3 w-3" />
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>Cloudflare wrapper active</TooltipContent>
                        </Tooltip>
                      )}
                      {c.tags?.map((t) => (
                        <span key={t} className="rounded bg-muted px-1.5 py-0.5 font-mono">
                          #{t}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <StatusPill status={c.sync_status} behind={c.commits_behind} />
              </CardHeader>
              <CardContent className="space-y-2 px-5 pb-5">
                <div className="font-mono text-xs text-muted-foreground">
                  {c.github_owner}/{c.github_repo}
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  {c.github_url && (
                    <a
                      href={c.github_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                    >
                      <Github className="h-3.5 w-3.5" /> repo
                    </a>
                  )}
                  {c.lovable_project_url && (
                    <a
                      href={c.lovable_project_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> lovable
                    </a>
                  )}
                  {c.deploy_url && (
                    <a
                      href={c.deploy_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> deploy
                    </a>
                  )}
                  <span className="ml-auto text-muted-foreground">
                    cascaded {formatDistanceToNow(c.last_cascade_at)}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = "primary",
  icon,
}: {
  label: string;
  value: number;
  tone?: "primary" | "success" | "warning" | "destructive";
  icon?: React.ReactNode;
}) {
  const toneCls = {
    primary: "text-primary",
    success: "text-success",
    warning: "text-warning",
    destructive: "text-destructive",
  }[tone];
  return (
    <Card className="border-border/80 bg-card">
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {label}
          </div>
          <div className={`mt-2 font-mono text-3xl font-semibold ${toneCls}`}>{value}</div>
        </div>
        <div className={`flex h-9 w-9 items-center justify-center rounded-md bg-muted ${toneCls}`}>
          {icon}
        </div>
      </CardContent>
    </Card>
  );
}

function DashboardEmpty() {
  return (
    <EmptyState
      icon={<GitBranch />}
      title="No clones in the fleet"
      description="Provision your first clone from the prime codebase. It can be a fork, a template instance, or an independent clone."
      action={
        <Link to="/clones/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" /> Provision first clone
          </Button>
        </Link>
      }
    />
  );
}
