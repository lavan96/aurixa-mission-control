import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Boxes } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type SyncStatus = Database["public"]["Enums"]["sync_status"];

type Counts = {
  total: number;
  in_sync: number;
  behind: number;
  failed: number;
  other: number;
};

const EMPTY: Counts = { total: 0, in_sync: 0, behind: 0, failed: 0, other: 0 };

export function ModuleCoverageStrip({ moduleId }: { moduleId: string }) {
  const [counts, setCounts] = useState<Counts | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("clone_modules")
        .select("clones(sync_status)")
        .eq("module_id", moduleId);

      const rows = (data ?? []) as Array<{ clones: { sync_status: SyncStatus } | null }>;
      const next: Counts = { ...EMPTY };
      for (const r of rows) {
        if (!r.clones) continue;
        next.total += 1;
        switch (r.clones.sync_status) {
          case "in_sync":
            next.in_sync += 1;
            break;
          case "behind":
            next.behind += 1;
            break;
          case "failed":
            next.failed += 1;
            break;
          default:
            next.other += 1;
        }
      }
      if (!cancelled) setCounts(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [moduleId]);

  if (!counts) {
    return (
      <div className="h-6 w-32 animate-pulse rounded bg-muted/40" aria-hidden />
    );
  }

  if (counts.total === 0) {
    return (
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <Boxes className="h-3 w-3" /> not installed
      </div>
    );
  }

  const segs = [
    { key: "in_sync", n: counts.in_sync, cls: "bg-success/70" },
    { key: "behind", n: counts.behind, cls: "bg-warning/70" },
    { key: "failed", n: counts.failed, cls: "bg-destructive/70" },
    { key: "other", n: counts.other, cls: "bg-muted-foreground/40" },
  ].filter((s) => s.n > 0);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <Boxes className="h-3 w-3" />
        coverage · {counts.total} clone{counts.total === 1 ? "" : "s"}
      </div>
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted/40">
        {segs.map((s) => (
          <div
            key={s.key}
            className={cn("h-full", s.cls)}
            style={{ width: `${(s.n / counts.total) * 100}%` }}
            title={`${s.key}: ${s.n}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] text-muted-foreground">
        {counts.in_sync > 0 && (
          <span className="text-success">{counts.in_sync} in sync</span>
        )}
        {counts.behind > 0 && (
          <span className="text-warning">{counts.behind} behind</span>
        )}
        {counts.failed > 0 && (
          <span className="text-destructive">{counts.failed} failed</span>
        )}
        {counts.other > 0 && <span>{counts.other} unknown</span>}
      </div>
    </div>
  );
}
