import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/protected-route";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Clone, Module } from "@/lib/queries";
import { useModules } from "@/lib/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/status-pill";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Github, ExternalLink, Shield, Trash2, Waves, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "@/lib/format";
import { CloneActivityHistory } from "@/components/clone-activity-history";
import { CloneDriftSuggestionsCard } from "@/components/clone-drift-suggestions-card";
import type { DriftSuggestion } from "@/server/drift-suggestions.functions";

export const Route = createFileRoute("/clones/$cloneId")({
  component: () => (
    <ProtectedRoute>
      <CloneDetail />
    </ProtectedRoute>
  ),
});

function CloneDetail() {
  const { cloneId } = useParams({ from: "/clones/$cloneId" });
  const [clone, setClone] = useState<Clone | null>(null);
  const [installed, setInstalled] = useState<Module[]>([]);
  const { data: allModules } = useModules();
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data: c } = await supabase.from("clones").select("*").eq("id", cloneId).maybeSingle();
    setClone(c);
    const { data: cm } = await supabase
      .from("clone_modules")
      .select("module_id, modules(*)")
      .eq("clone_id", cloneId);
    setInstalled((cm ?? []).map((r: any) => r.modules).filter(Boolean));
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [cloneId]);

  const inject = async (moduleId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("clone_modules")
      .insert({ clone_id: cloneId, module_id: moduleId, installed_by: user?.id });
    if (error) return toast.error(error.message);
    toast.success("Module injected — pushing commit to repo");
    const mod = allModules.find((m) => m.id === moduleId);
    await supabase.from("audit_log").insert({
      action: "module.injected",
      entity_type: "clone",
      entity_id: cloneId,
      actor_user_id: user?.id,
      metadata: { module_id: moduleId },
    });
    await supabase.from("notifications").insert({
      kind: "module_installed",
      severity: "info",
      title: `Module installed: ${mod?.name ?? "module"}`,
      body: clone ? `On ${clone.name}` : null,
      clone_id: cloneId,
      url: `/clones/${cloneId}`,
      metadata: { module_id: moduleId },
    });
    load();
  };
  const remove = async (moduleId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("clone_modules").delete().eq("clone_id", cloneId).eq("module_id", moduleId);
    toast.success("Module removed");
    const mod = allModules.find((m) => m.id === moduleId);
    await supabase.from("audit_log").insert({
      action: "module.removed",
      entity_type: "clone",
      entity_id: cloneId,
      actor_user_id: user?.id,
      metadata: { module_id: moduleId },
    });
    await supabase.from("notifications").insert({
      kind: "module_removed",
      severity: "info",
      title: `Module removed: ${mod?.name ?? "module"}`,
      body: clone ? `From ${clone.name}` : null,
      clone_id: cloneId,
      url: `/clones/${cloneId}`,
      metadata: { module_id: moduleId },
    });
    load();
  };
  const destroy = async () => {
    if (!confirm("Delete this clone? This cannot be undone.")) return;
    const cloneName = clone?.name ?? "Clone";
    await supabase.from("notifications").insert({
      kind: "clone_deleted",
      severity: "warning",
      title: `Clone deleted: ${cloneName}`,
      metadata: { clone_id: cloneId },
    });
    await supabase.from("clones").delete().eq("id", cloneId);
    toast.success("Clone deleted");
    history.back();
  };

  if (loading) {
    return <div className="font-mono text-sm text-muted-foreground">loading…</div>;
  }
  if (!clone) {
    return (
      <div className="space-y-3">
        <Link to="/dashboard" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="mr-1 h-4 w-4" /> back
        </Link>
        <div>Clone not found.</div>
      </div>
    );
  }

  const installedIds = new Set(installed.map((m) => m.id));
  const available = allModules.filter((m) => !installedIds.has(m.id));

  return (
    <div className="space-y-6">
      <Link to="/dashboard" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="mr-1 h-4 w-4" /> fleet
      </Link>

      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
            clone
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{clone.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <StatusPill status={clone.sync_status} behind={clone.commits_behind} />
            <Badge variant="outline" className="font-mono text-[10px] uppercase">
              {clone.provisioning_method}
            </Badge>
            <span className="font-mono">
              {clone.github_owner}/{clone.github_repo}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">
            <Waves className="mr-1.5 h-4 w-4" /> Cascade now
          </Button>
          <Button variant="ghost" onClick={destroy} className="text-destructive hover:text-destructive">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <InfoTile label="GitHub" value={clone.github_url ?? "—"} icon={<Github className="h-4 w-4" />} link={clone.github_url} />
        <InfoTile label="Lovable" value={clone.lovable_project_url ?? "—"} icon={<ExternalLink className="h-4 w-4" />} link={clone.lovable_project_url} />
        <InfoTile label="Deploy" value={clone.deploy_url ?? "—"} icon={<ExternalLink className="h-4 w-4" />} link={clone.deploy_url} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Module injector</CardTitle>
          <span className="font-mono text-xs text-muted-foreground">
            last cascade · {formatDistanceToNow(clone.last_cascade_at)}
          </span>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                installed ({installed.length})
              </div>
              <div className="space-y-2">
                {installed.length === 0 && (
                  <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                    No modules installed
                  </div>
                )}
                {installed.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2"
                  >
                    <span className="font-mono text-sm">{m.name}</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => remove(m.id)}
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                available ({available.length})
              </div>
              <div className="space-y-2">
                {available.length === 0 && (
                  <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                    All modules injected
                  </div>
                )}
                {available.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2"
                  >
                    <span className="font-mono text-sm">{m.name}</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => inject(m.id)}
                      className="h-7 w-7 text-muted-foreground hover:text-primary"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4 text-info" /> Cloudflare
          </CardTitle>
        </CardHeader>
        <CardContent>
          {clone.cloudflare_enabled ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline">WAF rules</Button>
              <Button size="sm" variant="outline">Bot protection</Button>
              <Button size="sm" variant="outline">Rate limiting</Button>
              <Button size="sm" variant="outline">DDoS</Button>
            </div>
          ) : (
            <Button variant="outline">
              <Shield className="mr-2 h-4 w-4" /> Add Cloudflare wrapper
            </Button>
          )}
        </CardContent>
      </Card>

      <CloneDriftSuggestionsCard
        cloneId={cloneId}
        suggestions={(clone.drift_suggestions as unknown as DriftSuggestion[] | null) ?? []}
        lastCheckedAt={clone.last_drift_check_at}
        onChange={load}
      />

      <CloneActivityHistory cloneId={cloneId} />
    </div>
  );
}

function InfoTile({
  label,
  value,
  icon,
  link,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  link?: string | null;
}) {
  const inner = (
    <Card className="bg-card">
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {label}
          </div>
          <div className="truncate text-sm">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
  if (link) {
    return (
      <a href={link} target="_blank" rel="noreferrer" className="block transition-opacity hover:opacity-80">
        {inner}
      </a>
    );
  }
  return inner;
}
