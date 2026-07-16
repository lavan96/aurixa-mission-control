import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Small "page X of Y" + Prev/Next control, matching the existing pager UX on
 * audit-log / leads / notifications. Used to cap rendered rows on log-style
 * screens that fetch a large list and would otherwise render all of it.
 *
 * `page` is 0-indexed. Renders nothing when there's a single page.
 */
export function ListPager({
  page,
  pageCount,
  onPage,
  className,
}: {
  page: number;
  pageCount: number;
  onPage: (next: number) => void;
  className?: string;
}) {
  if (pageCount <= 1) return null;
  return (
    <div className={cn("flex items-center justify-between gap-2 pt-2", className)}>
      <span className="font-mono text-xs text-muted-foreground">
        page {page + 1} of {pageCount}
      </span>
      <div className="flex gap-1">
        <Button
          size="sm"
          variant="outline"
          disabled={page <= 0}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="mr-1 h-3.5 w-3.5" /> Prev
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={page >= pageCount - 1}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          Next <ChevronRight className="ml-1 h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
