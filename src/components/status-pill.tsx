import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";

type SyncStatus = Database["public"]["Enums"]["sync_status"];

const META: Record<SyncStatus, { label: string; cls: string }> = {
  in_sync: { label: "in sync", cls: "bg-success/15 text-success border-success/30" },
  behind: { label: "behind", cls: "bg-warning/15 text-warning border-warning/30" },
  cascading: { label: "cascading", cls: "bg-info/15 text-info border-info/30 animate-pulse" },
  failed: { label: "failed", cls: "bg-destructive/15 text-destructive border-destructive/30" },
  unknown: { label: "unknown", cls: "bg-muted text-muted-foreground border-border" },
};

export function StatusPill({ status, behind }: { status: SyncStatus; behind?: number }) {
  const m = META[status];
  return (
    <Badge variant="outline" className={cn("font-mono text-[10px] uppercase tracking-wider", m.cls)}>
      <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-current" />
      {m.label}
      {status === "behind" && behind ? ` · ${behind}` : ""}
    </Badge>
  );
}
