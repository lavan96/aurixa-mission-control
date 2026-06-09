import { supabaseAdmin } from "@/integrations/supabase/client.server";

const DEFAULT_LIMIT = 60; // per minute per key

export type RateLimitResult =
  | { ok: true; count: number; limit: number }
  | { ok: false; count: number; limit: number; retry_after_seconds: number };

/**
 * Increment + check the per-key per-minute rate limit. Backed by
 * `public.check_api_rate_limit` so two replicas share state.
 */
export async function checkRateLimit(
  keyId: string,
  limit = DEFAULT_LIMIT,
): Promise<RateLimitResult> {
  const { data, error } = await supabaseAdmin.rpc("check_api_rate_limit", {
    _key_id: keyId,
    _limit: limit,
  });
  if (error) {
    // Fail open on DB error — better than blocking legitimate prime-repo traffic
    return { ok: true, count: 0, limit };
  }
  return data as RateLimitResult;
}
