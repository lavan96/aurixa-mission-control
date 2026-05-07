// Reusable refresh control with last-updated timestamp. Drop into page headers
// to give operators an at-a-glance freshness indicator + manual reload.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "@/lib/format";

export function RefreshButton({
  onRefresh,
  loading,
  lastUpdated,
  className,
  label = "Refresh",
}: {
  onRefresh: () => void | Promise<void>;
  loading?: boolean;
  /** Date or ISO string; if omitted, no relative time is shown. */
  lastUpdated?: Date | string | null;
  className?: string;
  label?: string;
}) {
  // Re-render every 30s so the relative timestamp stays fresh.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!lastUpdated) return;
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [lastUpdated]);

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {lastUpdated && (
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          updated {formatDistanceToNow(lastUpdated)}
        </span>
      )}
      <Button variant="outline" size="sm" onClick={() => void onRefresh()} disabled={loading}>
        <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loading && "animate-spin")} />
        {label}
      </Button>
    </div>
  );
}
