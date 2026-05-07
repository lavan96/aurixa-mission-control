import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback } from "react";

/**
 * Lightweight querystring state hook.
 *
 * For routes that already declare validateSearch with a Zod schema, prefer
 * Route.useSearch + navigate({ search: ... }) directly. This hook is for
 * ad-hoc UI state that doesn't justify a full schema (e.g. Fleet Health
 * filters, search inputs).
 *
 * Usage:
 *   const [filter, setFilter] = useUrlState<"all" | "down">("filter", "all");
 */
export function useUrlState<T extends string>(
  key: string,
  defaultValue: T,
): [T, (next: T) => void] {
  // strict: false because we're reading arbitrary keys not in the route's schema
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const navigate = useNavigate();

  const value = (search[key] as T | undefined) ?? defaultValue;

  const setValue = useCallback(
    (next: T) => {
      const out: Record<string, unknown> = { ...search };
      if (next === defaultValue || next === "" || next == null) {
        delete out[key];
      } else {
        out[key] = next;
      }
      navigate({ search: out as never, replace: true });
    },
    [key, defaultValue, navigate, search],
  );

  return [value, setValue];
}
