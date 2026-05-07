// Generic retry helper with exponential backoff + jitter.
// Use for outbound HTTP calls (Cloudflare API, GitHub API, etc.) that may
// hit transient 5xx, rate limits, or network blips.

export interface RetryOptions {
  /** Total attempts including the initial call. Default 3. */
  attempts?: number;
  /** Base backoff in ms (doubled each attempt + jitter). Default 300. */
  baseMs?: number;
  /** Cap per-attempt backoff. Default 5000. */
  maxMs?: number;
  /** Predicate — return false to stop retrying. Default: retry on any thrown error. */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  /** Called between attempts; useful for logging. */
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const baseMs = opts.baseMs ?? 300;
  const maxMs = opts.maxMs ?? 5000;
  const shouldRetry = opts.shouldRetry ?? (() => true);

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === attempts) break;
      if (!shouldRetry(err, attempt)) break;
      const expo = Math.min(baseMs * 2 ** (attempt - 1), maxMs);
      const delay = expo / 2 + Math.random() * (expo / 2);
      opts.onRetry?.(err, attempt, delay);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/**
 * Default predicate for HTTP-style retry: only retry on 5xx, 429, or
 * fetch network errors. 4xx (except 429) are considered terminal.
 */
export function isTransientHttpError(err: unknown): boolean {
  if (err instanceof TypeError) return true; // network-level fetch failure
  const status =
    (err as { status?: number; response?: { status?: number } } | null)?.status ??
    (err as { status?: number; response?: { status?: number } } | null)?.response?.status;
  if (typeof status !== "number") return true;
  return status === 429 || status >= 500;
}
