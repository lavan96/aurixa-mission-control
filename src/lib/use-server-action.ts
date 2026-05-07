// Shared hook around `useServerFn` that adds toast feedback + retry/backoff.
// Standardises error handling so individual call sites don't silently swallow
// failures.
import { useCallback, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

type AnyFn = (...args: any[]) => Promise<any>;

export interface UseServerActionOptions<T> {
  /** Toast message on success — pass false to disable. */
  successMessage?: string | ((result: T) => string) | false;
  /** Toast message on error — pass false to disable. */
  errorMessage?: string | ((err: unknown) => string) | false;
  /** Number of retries for transient failures. Default 0. */
  retries?: number;
  /** Backoff base in ms (doubled each attempt). Default 400. */
  backoffMs?: number;
  /** Called after a successful result. */
  onSuccess?: (result: T) => void;
  /** Called after a failure (after retries exhausted). */
  onError?: (err: unknown) => void;
}

export function useServerAction<F extends AnyFn>(
  fn: F,
  opts: UseServerActionOptions<Awaited<ReturnType<F>>> = {},
) {
  const wrapped = useServerFn(fn);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const execute = useCallback(
    async (...args: Parameters<F>): Promise<Awaited<ReturnType<F>> | null> => {
      const o = optsRef.current;
      const retries = o.retries ?? 0;
      const baseBackoff = o.backoffMs ?? 400;
      setIsPending(true);
      setError(null);

      let attempt = 0;
      let lastErr: unknown = null;
      while (attempt <= retries) {
        try {
          const result = (await wrapped(...args)) as Awaited<ReturnType<F>>;
          // Many of our server fns return { ok: false, error } shape — surface that too.
          if (result && typeof result === "object" && (result as any).ok === false) {
            const errMsg = (result as any).error ?? "Operation failed";
            throw new Error(String(errMsg));
          }
          if (o.successMessage !== false) {
            const msg =
              typeof o.successMessage === "function"
                ? o.successMessage(result)
                : (o.successMessage ?? null);
            if (msg) toast.success(msg);
          }
          o.onSuccess?.(result);
          setIsPending(false);
          return result;
        } catch (err) {
          lastErr = err;
          attempt++;
          if (attempt > retries) break;
          await new Promise((r) => setTimeout(r, baseBackoff * 2 ** (attempt - 1)));
        }
      }
      setError(lastErr);
      if (o.errorMessage !== false) {
        const msg =
          typeof o.errorMessage === "function"
            ? o.errorMessage(lastErr)
            : (o.errorMessage ??
              (lastErr instanceof Error ? lastErr.message : "Something went wrong"));
        if (msg) toast.error(msg);
      }
      o.onError?.(lastErr);
      setIsPending(false);
      return null;
    },
    [wrapped],
  );

  return { execute, isPending, error };
}
