import { useCallback, useEffect, useRef } from "react";

/**
 * Returns a debounced version of `fn`: rapid calls within `delay` ms coalesce
 * into a single trailing invocation. Used to tame Realtime refetch storms — a
 * busy cascade emits many `postgres_changes` events, and firing a full refresh
 * on each one hammers the database. The debounced callback keeps a stable
 * identity and always calls the latest `fn`.
 */
export function useDebouncedCallback<A extends unknown[]>(
  fn: (...args: A) => void,
  delay = 400,
): (...args: A) => void {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return useCallback(
    (...args: A) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => fnRef.current(...args), delay);
    },
    [delay],
  );
}
