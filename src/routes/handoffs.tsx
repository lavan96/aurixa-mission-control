// @ts-nocheck
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ProtectedRoute } from "@/components/protected-route";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listHandoffs } from "@/lib/handoffs.functions";
import { getPrimeOrgCapacity } from "@/lib/org-capacity.functions";
import { ArrowRightLeft, Plus, Gauge } from "lucide-react";

export const Route = createFileRoute("/handoffs")({
  component: () => (
    <ProtectedRoute>
      <HandoffsPage />
    </ProtectedRoute>
  ),
  head: () => ({ meta: [{ title: "Handoffs — Aurixa Systems" }] }),
});

function stateVariant(state: string): "default" | "secondary" | "destructive" | "outline" {
  if (state === "complete") return "default";
  if (state === "failed" || state === "rolled_back" || state === "canceled") return "destructive";
  if (state === "draft" || state === "awaiting_client_consent") return "secondary";
  return "outline";
}

function HandoffsPage() {
  const q = useQuery({ queryKey: ["handoffs"], queryFn: () => listHandoffs() });
  const cap = useQuery({
    queryKey: ["handoffs", "prime-org-capacity"],
    queryFn: () => getPrimeOrgCapacity(),
    retry: false,
    staleTime: 60_000,
  });
  const rows = q.data ?? [];
  const capData: any = cap.data;
  const capTone = capData?.hardBlock
    ? "destructive"
    : capData?.wouldExceed
    ? "secondary"
    : "default";
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <ArrowRightLeft className="h-6 w-6" /> Client Handoffs
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Transfer clone backends to client-owned Supabase organizations.
          </p>
        </div>
        <Button asChild>
          <Link to="/handoffs/new">
            <Plus className="h-4 w-4 mr-2" /> New handoff
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Gauge className="h-4 w-4" /> Prime Supabase org capacity (G10)
              </CardTitle>
              <CardDescription>
                Preflight check that runs before every new project create. Handoff twin
                builds also run this against the client's PAT.
              </CardDescription>
            </div>
            {capData && (
              <Badge variant={capTone as any}>
                {capData.activeProjects}/{capData.softLimit} projects
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="text-sm space-y-1">
          {cap.isLoading && <p className="text-muted-foreground">Checking…</p>}
          {cap.error && (
            <p className="text-destructive">
              Capacity check failed: {String((cap.error as Error).message)}
            </p>
          )}
          {capData && (
            <>
              <p>
                Org: <span className="font-mono">{capData.orgName ?? capData.orgId}</span> · Plan:{" "}
                <span className="font-mono">{capData.planTier ?? "unknown"}</span>
              </p>
              {capData.reason && (
                <p className={capData.hardBlock ? "text-destructive" : "text-amber-500"}>
                  {capData.reason}
                </p>
              )}
              {!capData.reason && (
                <p className="text-muted-foreground">
                  Headroom OK — provisioning may proceed.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {q.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!q.isLoading && rows.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>No handoffs yet</CardTitle>
            <CardDescription>
              Start a handoff to migrate a clone backend into the client's own Supabase organization.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {rows.map((h: any) => (
          <Card key={h.id}>
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base">
                    {h.clones?.name ?? h.clone_id}
                  </CardTitle>
                  <CardDescription>
                    Path: {h.path} · Region: {h.target_region ?? "—"} · Plan: {h.target_plan_tier ?? "—"}
                  </CardDescription>
                </div>
                <Badge variant={stateVariant(h.state)}>{h.state}</Badge>
              </div>
            </CardHeader>
            <CardContent className="flex justify-between text-sm text-muted-foreground">
              <span>Created {new Date(h.created_at).toLocaleString()}</span>
              <Link to="/handoffs/$handoffId" params={{ handoffId: h.id }} className="text-primary hover:underline">
                Open →
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
