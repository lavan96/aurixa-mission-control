import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Github, RefreshCw, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { getGitHubStatus, type GitHubStatus } from "@/server/github-status.functions";
import { useAuth } from "@/lib/auth";

export function GitHubStatusCard() {
  const fn = useServerFn(getGitHubStatus);
  const { session, loading: authLoading } = useAuth();
  const [status, setStatus] = useState<GitHubStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fn();
      setStatus(res);
    } catch (e) {
      // The auth middleware throws raw Response objects on 401 — unwrap so
      // we don't render "[object Response]" or crash the error boundary.
      let message = "Unknown error";
      if (e instanceof Response) {
        try {
          message = (await e.text()) || `HTTP ${e.status}`;
        } catch {
          message = `HTTP ${e.status}`;
        }
      } else if (e instanceof Error) {
        message = e.message;
      }
      setStatus({
        ok: false,
        configured: false,
        error: message,
        repos: [],
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Wait for auth to resolve before firing — calling unauthenticated yields
    // a 401 Response throw that crashes the page.
    if (authLoading) return;
    if (!session) {
      setStatus({
        ok: false,
        configured: false,
        error: "Sign in to view GitHub App status",
        repos: [],
      });
      setLoading(false);
      return;
    }
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, session]);

  const reachableCount = status?.repos.filter((r) => r.ok).length ?? 0;
  const totalCount = status?.repos.length ?? 0;
  const allReachable = totalCount > 0 && reachableCount === totalCount;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Github className="h-4 w-4" /> GitHub App connection
            </CardTitle>
            <CardDescription>
              Live status of the Aurixa GitHub App — installation, accessible repos, and per-clone reachability.
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={refresh} disabled={loading}>
            <RefreshCw className={cn("mr-2 h-3.5 w-3.5", loading && "animate-spin")} />
            {loading ? "Checking…" : "Re-check"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!status ? (
          <div className="text-sm text-muted-foreground">Checking GitHub App…</div>
        ) : !status.configured ? (
          <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="space-y-1 text-sm">
              <div className="font-medium text-destructive">Not configured</div>
              <div className="text-muted-foreground">{status.error}</div>
              <div className="text-xs text-muted-foreground">
                Set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, and GITHUB_APP_INSTALLATION_ID secrets.
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Tile label="App" value={status.app?.name ?? "—"} sub={status.app ? `id ${status.app.app_id}` : undefined} />
              <Tile
                label="Installation"
                value={status.installation?.account ?? "—"}
                sub={
                  status.installation
                    ? `${status.installation.visible_repo_count} repo${status.installation.visible_repo_count === 1 ? "" : "s"} accessible`
                    : undefined
                }
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  reachability
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] uppercase",
                    allReachable
                      ? "border-success/40 text-success"
                      : "border-warning/40 text-warning",
                  )}
                >
                  {reachableCount}/{totalCount} reachable
                </Badge>
              </div>
              {status.repos.length === 0 ? (
                <div className="rounded-md border border-border bg-surface p-3 text-sm text-muted-foreground">
                  No prime or clones configured yet.
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {status.repos.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2 text-sm"
                    >
                      {r.ok ? (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                      )}
                      <div className="flex-1 truncate">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs">{r.owner}/{r.repo}</span>
                          <Badge variant="outline" className="text-[9px] uppercase">
                            {r.role}
                          </Badge>
                        </div>
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {r.branch}
                          {r.ok && r.default_branch_sha && <> · {r.default_branch_sha}</>}
                          {!r.ok && r.error && <> · {r.error}</>}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-mono text-sm font-medium">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
