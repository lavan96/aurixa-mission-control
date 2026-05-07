// Shared bulk-action toolbar — sticky bar that floats at the top of a list
// when one or more rows are selected. Hosts a slot for action buttons.
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function BulkActionBar({
  count,
  noun,
  onClear,
  children,
  className,
}: {
  count: number;
  noun: string;
  onClear: () => void;
  children: ReactNode;
  className?: string;
}) {
  if (count === 0) return null;
  return (
    <div
      className={cn(
        "sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-md border border-primary/40 bg-surface/95 px-3 py-2 shadow-md backdrop-blur",
        className,
      )}
    >
      <span className="font-mono text-xs text-muted-foreground">
        {count} {noun}
        {count === 1 ? "" : "s"} selected
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
      <Button variant="ghost" size="icon" onClick={onClear} aria-label="Clear selection">
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
