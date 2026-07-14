import { createFileRoute } from "@tanstack/react-router";
import crypto from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  cleanLeadText,
  dedupeKeyFor,
  parseLead,
  type ParsedLead,
} from "@/server/lead-capture.server";

/**
 * POST /api/public/leads/capture
 *
 * Waitlist lead ingest — the tie-up between the Aurixa Systems landing page
 * and Mission Control. Two delivery paths feed this endpoint:
 *
 *  1. Browser dual-write: the waitlist form on the website fires its existing
 *     Make.com webhook (→ Airtable) and, on success, also posts the same
 *     payload here (fire-and-forget, CORS-gated to the site's origins).
 *  2. Make.com forward: an HTTP module in the Make scenario posts the payload
 *     server-to-server with the `x-lead-capture-secret` header.
 *
 * Both paths can deliver the same submission; the dedupe key (hash of
 * email + submittedAt) collapses them into a single lead row and a single
 * `lead_captured` notification, which reaches operators live via Supabase
 * realtime (bell + /leads page + browser push).
 *
 * Auth model:
 *  - A request carrying a valid LEAD_CAPTURE_SECRET is always trusted.
 *  - Otherwise the request must come from an allow-listed browser Origin and
 *    passes strict validation plus per-IP and global rate limits.
 */

const DEFAULT_ALLOWED_ORIGINS = [
  "https://www.aurixasystems.com.au",
  "https://aurixasystems.com.au",
  "http://localhost:3000",
];

// Unauthenticated-path rate limits (secret-bearing requests bypass these).
const PER_IP_LIMIT = 8; // submissions per IP per 10 minutes
const PER_IP_WINDOW_MS = 10 * 60 * 1000;
const GLOBAL_LIMIT = 300; // submissions per hour across all IPs
const GLOBAL_WINDOW_MS = 60 * 60 * 1000;

function allowedOrigins(): string[] {
  const extra = (process.env.LEAD_CAPTURE_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return [...DEFAULT_ALLOWED_ORIGINS, ...extra];
}

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && allowedOrigins().includes(origin.replace(/\/+$/, ""));
  return {
    "Access-Control-Allow-Origin": allowed ? origin! : DEFAULT_ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-lead-capture-secret",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function hasValidSecret(request: Request): boolean {
  const secret = process.env.LEAD_CAPTURE_SECRET;
  if (!secret) return false;
  const header = request.headers.get("x-lead-capture-secret") ?? "";
  const auth = request.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  return (
    (header.length > 0 && timingSafeEqualStr(header, secret)) ||
    (bearer.length > 0 && timingSafeEqualStr(bearer, secret))
  );
}

async function checkLeadRateLimits(ip: string | null): Promise<{ ok: boolean; reason?: string }> {
  const globalSince = new Date(Date.now() - GLOBAL_WINDOW_MS).toISOString();
  const { count: globalCount } = await supabaseAdmin
    .from("waitlist_leads")
    .select("id", { count: "exact", head: true })
    .gte("created_at", globalSince);
  if ((globalCount ?? 0) >= GLOBAL_LIMIT) return { ok: false, reason: "global_rate_limited" };

  if (ip) {
    const ipSince = new Date(Date.now() - PER_IP_WINDOW_MS).toISOString();
    const { count: ipCount } = await supabaseAdmin
      .from("waitlist_leads")
      .select("id", { count: "exact", head: true })
      .gte("created_at", ipSince)
      .contains("metadata", { ip });
    if ((ipCount ?? 0) >= PER_IP_LIMIT) return { ok: false, reason: "rate_limited" };
  }
  return { ok: true };
}

// Best effort — the lead row is the source of truth; a failed notification or
// audit entry must not fail (and re-trigger) the webhook delivery.
async function fanOutLeadCaptured(
  leadId: string,
  lead: ParsedLead,
  channel: "make_webhook" | "website",
) {
  const entity = lead.entity_name
    ? `${lead.entity_name}${lead.entity_classification ? ` (${lead.entity_classification.replace(/_/g, " ")})` : ""}`
    : "Unknown entity";
  const volume = lead.transaction_volume ? ` · volume ${lead.transaction_volume}` : "";
  try {
    await supabaseAdmin.from("notifications").insert({
      kind: "lead_captured",
      severity: "success",
      title: `New waitlist lead: ${lead.first_name} ${lead.last_name}`,
      body: `${entity} · ${lead.email}${volume}`,
      url: "/leads",
      metadata: {
        lead_id: leadId,
        email: lead.email,
        entity_classification: lead.entity_classification,
        transaction_volume: lead.transaction_volume,
        source: lead.source,
        channel,
      },
    });
  } catch (err) {
    console.error("lead_captured notification insert failed", err);
  }
  try {
    await supabaseAdmin.from("audit_log").insert({
      action: "lead.captured",
      entity_type: "waitlist_lead",
      entity_id: leadId,
      metadata: { email: lead.email, source: lead.source, channel },
    });
  } catch (err) {
    console.error("lead.captured audit insert failed", err);
  }
}

export const Route = createFileRoute("/api/public/leads/capture")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) =>
        new Response(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) }),

      POST: async ({ request }) => {
        const origin = request.headers.get("origin");
        const trusted = hasValidSecret(request);

        if (!trusted) {
          // Browser path: only accept posts from the landing site's origins.
          const normalizedOrigin = (origin ?? "").replace(/\/+$/, "");
          if (!normalizedOrigin || !allowedOrigins().includes(normalizedOrigin)) {
            return json({ ok: false, error: "forbidden_origin" }, 403, origin);
          }
        }

        let payload: Record<string, unknown>;
        try {
          const parsed: unknown = await request.json();
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return json({ ok: false, error: "invalid_payload" }, 400, origin);
          }
          payload = parsed as Record<string, unknown>;
        } catch {
          return json({ ok: false, error: "invalid_json" }, 400, origin);
        }

        const lead = parseLead(payload);
        if ("error" in lead) return json({ ok: false, error: lead.error }, 422, origin);

        const ip =
          request.headers.get("cf-connecting-ip") ??
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          null;

        if (!trusted) {
          const rl = await checkLeadRateLimits(ip);
          if (!rl.ok) return json({ ok: false, error: rl.reason }, 429, origin);
        }

        const dedupe_key = dedupeKeyFor(lead);
        const { data: inserted, error } = await supabaseAdmin
          .from("waitlist_leads")
          .insert({
            ...lead,
            dedupe_key,
            metadata: {
              channel: trusted ? "make_webhook" : "website",
              ...(ip ? { ip } : {}),
              user_agent: cleanLeadText(request.headers.get("user-agent"), 400) || null,
            },
          })
          .select("id")
          .single();

        if (error) {
          // 23505 = unique_violation on dedupe_key → the same submission
          // already arrived via the other delivery path. That's success.
          if (error.code === "23505") {
            return json({ ok: true, duplicate: true }, 200, origin);
          }
          console.error("waitlist_leads insert failed", error);
          return json({ ok: false, error: "storage_failed" }, 500, origin);
        }

        await fanOutLeadCaptured(inserted.id, lead, trusted ? "make_webhook" : "website");

        return json({ ok: true, lead_id: inserted.id, duplicate: false }, 201, origin);
      },
    },
  },
});
