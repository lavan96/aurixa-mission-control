import { cn } from "@/lib/utils";

type FireStatus = "completed" | "failed" | "running" | "partial" | "pending";

const TONE: Record<FireStatus, string> = {
  completed: "bg-success",
  failed: "bg-destructive",
  partial: "bg-warning",
  running: "bg-info animate-pulse",
  pending: "bg-muted-foreground/40",
};

/**
 * Compact sparkline of the last N schedule fires.
 * Oldest on the left, most recent on the right — read like a timeline.
 */
export function ScheduleFiresSparkline({
  statuses,
  className,
}: {
  statuses: string[];
  className?: string;
}) {
  if (statuses.length === 0) return null;

  // Reverse so most recent is on the right (statuses come in newest-first).
  const ordered = [...statuses].reverse();
  const succ = statuses.filter((s) => s === "completed").length;
  const fail = statuses.filter((s) => s === "failed").length;

  return (
    <div
      className={cn("flex items-center gap-2", className)}
      title={`Last ${statuses.length} runs · ${succ} ok · ${fail} failed`}
    >
      <div className="flex h-3 items-end gap-[2px]">
        {ordered.map((s, i) => {
          const tone = TONE[(s as FireStatus) ?? "pending"] ?? TONE.pending;
          return (
            <span
              key={i}
              className={cn("h-3 w-1 rounded-sm", tone)}
              aria-label={s}
            />
          );
        })}
      </div>
      <span className="font-mono text-[10px] text-muted-foreground">
        <span className="text-success">{succ}</span>
        {" / "}
        <span className="text-destructive">{fail}</span>
      </span>
    </div>
  );
}
