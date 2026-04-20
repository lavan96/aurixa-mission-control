import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Webhook, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type AuditRow = {
  id: string;
  action: string;
  entity_id: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
};

function actionVariant(action: string): "default" | "secondary" | "destructive" | "outline" {
  if (action.includes("cascade_triggered")) return "default";
  if (action.includes("skipped")) return "secondary";
  if (action.includes("failed") || action.includes("error")) return "destructive";
  return "outline";
}

export function WebhookDeliveriesPanel() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("audit_log")
      .select("id, action, entity_id, created_at, metadata")
      .like("action", "webhook.%")
      .order("created_at", { ascending: false })
      .limit(20);
    setRows((data ?? []) as AuditRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const channel = supabase
      .channel("webhook-deliveries")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "audit_log" },
        (payload) => {
          const row = payload.new as AuditRow;
          if (typeof row.action === "string" && row.action.startsWith("webhook.")) {
            setRows((prev) => [row, ...prev].slice(0, 20));
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [refresh]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <Webhook className="h-4 w-4" /> Recent webhook deliveries
          </CardTitle>
          <CardDescription>
            Last 20 GitHub webhook events received at <code className="text-xs">/hooks/github</code>.
          </CardDescription>
        </div>
        <Button variant="ghost" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent>
        {loading && rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No webhook deliveries yet. Push a commit to prime to test.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => {
              const meta = r.metadata ?? {};
              const delivery = typeof meta.delivery === "string" ? meta.delivery : null;
              const reason = typeof meta.reason === "string" ? meta.reason : null;
              const mode = typeof meta.mode === "string" ? meta.mode : null;
              const cloneCount = typeof meta.cloneCount === "number" ? meta.cloneCount : null;
              return (
                <li key={r.id} className="py-2 text-sm flex items-start justify-between gap-3">
                  <div className="space-y-0.5 min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={actionVariant(r.action)} className="font-mono text-xs">
                        {r.action.replace("webhook.", "")}
                      </Badge>
                      {mode && (
                        <span className="text-xs text-muted-foreground">mode: {mode}</span>
                      )}
                      {cloneCount !== null && (
                        <span className="text-xs text-muted-foreground">
                          {cloneCount} clone{cloneCount === 1 ? "" : "s"}
                        </span>
                      )}
                    </div>
                    {reason && <div className="text-xs text-muted-foreground truncate">{reason}</div>}
                    {delivery && (
                      <div className="text-xs font-mono text-muted-foreground truncate">
                        {delivery}
                      </div>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
