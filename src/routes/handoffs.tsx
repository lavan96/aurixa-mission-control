// @ts-nocheck
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ProtectedRoute } from "@/components/protected-route";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listHandoffs } from "@/lib/handoffs.functions";
import { ArrowRightLeft, Plus } from "lucide-react";

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
  const rows = q.data ?? [];
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
