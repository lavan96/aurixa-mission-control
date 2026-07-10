// Billing handoff minting (user-attributed pricing workflow, Phase 2;
// see docs/user-tracking-pricing-workflow-plan.md §4 Phase 2).
//
// A handoff is a short-lived, single-use token that carries the identity of
// the command-center user who initiated a purchase. It is minted strictly
// server-to-server under a clone API key; the browser only ever sees the
// opaque `?h=<uuid>` — never the identity fields themselves.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adminAny = supabaseAdmin as any;

export const HANDOFF_TTL_MINUTES = 30;

export type CreateHandoffInput = {
  cloneId: string | null;
  tenantId: string | null;
  originUserId: string;
  originUsername?: string | null;
  originSource: string;
  intent?: string | null;
  returnUrl?: string | null;
};

/** Parses the mode prefix out of an intent string ('<mode>' or '<mode>:<item_id>'). */
export function intentMode(intent: string | null | undefined): string | null {
  if (!intent) return null;
  const mode = intent.split(":")[0]?.trim();
  return mode || null;
}

/**
 * Picks the landing page for a handoff. Topup intents deep-link straight to
 * the topup page; everything else lands on the full pricing page.
 */
export function handoffLandingPath(intent: string | null | undefined): string {
  return intentMode(intent) === "topup" ? "/billing/topup" : "/pricing";
}

export function handoffUrl(baseUrl: string, handoffId: string, intent?: string | null): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}${handoffLandingPath(intent)}?h=${encodeURIComponent(handoffId)}`;
}

/**
 * Open-redirect guard for the "back to your dashboard" URL. Must be https;
 * when the clone has a deploy_url with a resolvable host, the return URL must
 * point at that same host.
 */
export function validateReturnUrl(
  returnUrl: string | null | undefined,
  cloneDeployUrl: string | null | undefined,
): { ok: true; url: string | null } | { ok: false; error: string } {
  if (!returnUrl) return { ok: true, url: null };
  let parsed: URL;
  try {
    parsed = new URL(returnUrl);
  } catch {
    return { ok: false, error: "return_url_invalid" };
  }
  if (parsed.protocol !== "https:") return { ok: false, error: "return_url_not_https" };

  if (cloneDeployUrl) {
    try {
      const deployHost = new URL(cloneDeployUrl).host;
      if (deployHost && parsed.host !== deployHost) {
        return { ok: false, error: "return_url_host_mismatch" };
      }
    } catch {
      // Unparseable deploy_url on the clone record — fall through to accept
      // any https URL rather than blocking purchases on bad clone config.
    }
  }
  return { ok: true, url: parsed.toString() };
}

export async function createHandoff(
  input: CreateHandoffInput,
): Promise<{ ok: true; id: string; expiresAt: string } | { ok: false; error: string }> {
  const expiresAt = new Date(Date.now() + HANDOFF_TTL_MINUTES * 60_000).toISOString();
  const { data, error } = await adminAny
    .from("billing_handoffs")
    .insert({
      clone_id: input.cloneId,
      tenant_id: input.tenantId,
      origin_user_id: input.originUserId,
      origin_username: input.originUsername ?? null,
      origin_source: input.originSource,
      intent: input.intent ?? null,
      return_url: input.returnUrl ?? null,
      expires_at: expiresAt,
    })
    .select("id, expires_at")
    .single();
  if (error || !data) {
    return { ok: false, error: error?.message ?? "handoff_insert_failed" };
  }
  return { ok: true, id: data.id as string, expiresAt: (data.expires_at as string) ?? expiresAt };
}
