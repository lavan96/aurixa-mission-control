import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Standard page header — codifies the dominant "mono eyebrow + title +
 * description + actions" pattern used across the app (dashboard, drift,
 * cascades, settings, …) so every screen renders it identically.
 *
 * This intentionally mirrors the existing markup (see `dashboard.tsx` header)
 * so adopting it on a screen is a visual no-op, not a redesign.
 *
 * Usage:
 *   <PageHeader
 *     eyebrow="fleet-wide"
 *     title="Drift dashboard"
 *     description="All open AI suggestions across the fleet."
 *     actions={<Button>New</Button>}
 *   />
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  icon,
  breadcrumbs,
  className,
}: {
  /** Small mono uppercase kicker above the title. */
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned controls (buttons, links). Wrap in a fragment for multiple. */
  actions?: ReactNode;
  /** Optional icon rendered inline before the title. */
  icon?: ReactNode;
  /** Optional composed `<Breadcrumb>` region rendered above the eyebrow. */
  breadcrumbs?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("space-y-4", className)}>
      {breadcrumbs}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          {eyebrow && (
            <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
              {eyebrow}
            </p>
          )}
          <h1
            className={cn(
              "mt-1 text-3xl font-semibold tracking-tight",
              icon && "flex items-center gap-2",
            )}
          >
            {icon}
            {title}
          </h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2 md:justify-end">{actions}</div>}
      </div>
    </header>
  );
}
