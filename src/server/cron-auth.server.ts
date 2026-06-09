// Shared authentication for cron / scheduled-hook endpoints (src/routes/hooks.*).
//
// Previously each hook compared the Bearer token against the Supabase
// *publishable* key — which is PUBLIC (it ships in the client bundle), so those
// privileged endpoints were effectively unauthenticated. This helper requires a
// dedicated, non-public shared secret (CRON_SECRET) and compares it in constant
// time. It fails closed: if CRON_SECRET is unset, every request is rejected.
import crypto from "crypto";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Constant-time string comparison. A length mismatch returns false up front
// (timingSafeEqual requires equal-length buffers); the secret's length is not
// itself sensitive.
function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Verify a scheduled-hook request carries the shared cron secret as a Bearer
 * token. Returns `null` when the request is authorized, or a `Response`
 * (401/500) that the handler should return immediately.
 *
 * Accepts `CRON_SECRET` (preferred). For backward compatibility during rollout
 * it also accepts `DRIFT_REFRESH_TOKEN` — a non-public secret already used by
 * the drift-refresh job — so existing schedulers keep working while the cron
 * jobs are migrated to CRON_SECRET. The public publishable/anon key is no
 * longer accepted by any hook.
 */
export function verifyCronAuth(request: Request): Response | null {
  const secrets = [process.env.CRON_SECRET, process.env.DRIFT_REFRESH_TOKEN].filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );
  if (secrets.length === 0) {
    return jsonResponse({ error: "cron_secret_not_configured" }, 500);
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!token || !secrets.some((secret) => timingSafeEqualStr(token, secret))) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  return null;
}
