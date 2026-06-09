// Thin wrapper around React Query's useMutation that codifies the
// snapshot/rollback optimistic-update pattern so individual call sites
// don't have to re-implement it.
//
// Usage:
//   const { mutate } = useOptimisticMutation({
//     mutationFn: (vars) => updateThingFn({ data: vars }),
//     queryKey: ["things"],
//     applyOptimistic: (old: Thing[], vars) =>
//       old.map((t) => (t.id === vars.id ? { ...t, ...vars.patch } : t)),
//   });

import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";

export interface OptimisticMutationOptions<TData, TVars, TSnapshot> {
  mutationFn: (vars: TVars) => Promise<TData>;
  /** Single query key to snapshot/restore. Pass an array of keys via `queryKeys` for multi-cache updates. */
  queryKey?: QueryKey;
  queryKeys?: QueryKey[];
  /** Pure function: produce new cache value from previous + variables. */
  applyOptimistic?: (previous: TSnapshot, vars: TVars) => TSnapshot;
  /** Toast on success. Pass false to suppress. Default false. */
  successMessage?: string | ((data: TData, vars: TVars) => string) | false;
  /** Toast on error. Pass false to suppress. Default error.message. */
  errorMessage?: string | ((err: unknown, vars: TVars) => string) | false;
  onSuccess?: (data: TData, vars: TVars) => void;
  onError?: (err: unknown, vars: TVars) => void;
  /** Invalidate after settle. Default true. */
  invalidateOnSettled?: boolean;
}

export function useOptimisticMutation<TData = unknown, TVars = void, TSnapshot = unknown>(
  opts: OptimisticMutationOptions<TData, TVars, TSnapshot>,
) {
  const qc = useQueryClient();
  const keys = opts.queryKeys ?? (opts.queryKey ? [opts.queryKey] : []);

  return useMutation<TData, unknown, TVars, { snapshots: Array<[QueryKey, unknown]> }>({
    mutationFn: opts.mutationFn,
    onMutate: async (vars) => {
      const snapshots: Array<[QueryKey, unknown]> = [];
      for (const key of keys) {
        await qc.cancelQueries({ queryKey: key });
        const prev = qc.getQueryData(key);
        snapshots.push([key, prev]);
        if (opts.applyOptimistic && prev !== undefined) {
          qc.setQueryData(key, opts.applyOptimistic(prev as TSnapshot, vars));
        }
      }
      return { snapshots };
    },
    onError: (err, vars, ctx) => {
      // Roll back
      ctx?.snapshots.forEach(([key, prev]) => qc.setQueryData(key, prev));
      if (opts.errorMessage !== false) {
        const msg =
          typeof opts.errorMessage === "function"
            ? opts.errorMessage(err, vars)
            : (opts.errorMessage ?? (err instanceof Error ? err.message : "Something went wrong"));
        if (msg) toast.error(msg);
      }
      opts.onError?.(err, vars);
    },
    onSuccess: (data, vars) => {
      if (opts.successMessage !== undefined && opts.successMessage !== false) {
        const msg =
          typeof opts.successMessage === "function"
            ? opts.successMessage(data, vars)
            : opts.successMessage;
        if (msg) toast.success(msg);
      }
      opts.onSuccess?.(data, vars);
    },
    onSettled: () => {
      if (opts.invalidateOnSettled !== false) {
        for (const key of keys) qc.invalidateQueries({ queryKey: key });
      }
    },
  });
}
