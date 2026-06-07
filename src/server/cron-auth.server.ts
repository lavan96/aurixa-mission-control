// Shared cron auth — requires `Authorization: Bearer <DRIFT_REFRESH_TOKEN>`.
// Replaces the prior pattern of accepting the publishable anon key, which is
// a public value and therefore not a secret.
//
// pg_cron jobs read the same value from Supabase Vault entry `cron_secret`
// (added by the operator) and inject it as the Authorization header.
export function verifyCronAuth(request: Request): { ok: true } | { ok: false; response: Response } {
  const secret = process.env.DRIFT_REFRESH_TOKEN;
  if (!secret) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: "DRIFT_REFRESH_TOKEN not configured on server" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      ),
    };
  }
  const auth = request.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!bearer || bearer !== secret) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ),
    };
  }
  return { ok: true };
}
