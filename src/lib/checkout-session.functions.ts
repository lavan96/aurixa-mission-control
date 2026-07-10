// Look up a Stripe Checkout Session and resolve the associated clone/item
// so the success page can confirm which client was billed.
//
// Access — two paths:
//   1. Mission Control operators (requireOperator), which prevents any
//      authenticated user from arbitrarily enumerating other tenants'
//      sessions by guessing or harvesting `cs_…` IDs.
//   2. Handoff holders (Phase 3, no login): the caller must present the
//      session id AND the matching handoff id — the pair only ever exists in
//      the redirect URL Stripe sent that purchaser to, so possession proves
//      the caller completed that specific checkout.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOperator } from "@/integrations/supabase/role-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getStripe } from "@/server/stripe.server";
import { loadHandoffById } from "@/server/billing-handoffs.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adminAny = supabaseAdmin as any;

/**
 * Proves a session belongs to a handoff: the purchases row (or, as fallback
 * for rows whose initiated-insert failed, the Stripe session metadata) must
 * reference exactly this handoff id.
 */
async function sessionMatchesHandoff(sessionId: string, handoffId: string): Promise<boolean> {
  const { data: purchase } = await adminAny
    .from("purchases")
    .select("handoff_id")
    .eq("stripe_checkout_session_id", sessionId)
    .maybeSingle();
  if (purchase?.handoff_id) return purchase.handoff_id === handoffId;
  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId);
    return (session.metadata?.handoff_id ?? null) === handoffId;
  } catch {
    return false;
  }
}

async function buildSessionSummary(sessionId: string) {
  const session = await getStripe().checkout.sessions.retrieve(sessionId);
  const meta = (session.metadata ?? {}) as Record<string, string>;
  const mode = meta.mode ?? null;
  const itemSlug = meta.item_slug ?? null;
  const tenantId = meta.tenant_id || null;
  const cloneId = meta.clone_id || null;

  let cloneName: string | null = null;
  if (cloneId) {
    const { data: clone } = await adminAny
      .from("clones")
      .select("name, slug")
      .eq("id", cloneId)
      .maybeSingle();
    cloneName = clone?.name ?? clone?.slug ?? null;
  }

  let tenantName: string | null = null;
  if (!cloneName && tenantId) {
    const { data: tenant } = await supabaseAdmin
      .from("tenants")
      .select("display_name, external_ref")
      .eq("id", tenantId)
      .maybeSingle();
    tenantName = tenant?.display_name ?? tenant?.external_ref ?? null;
  }

  // Attribution (user-attributed pricing workflow): prefer the purchases
  // row, fall back to session metadata for sessions created mid-deploy.
  let originUsername = meta.origin_username || null;
  let originUserId = meta.origin_user_id || null;
  let originSource = meta.origin_source || null;
  const { data: purchase } = await adminAny
    .from("purchases")
    .select("origin_user_id, origin_username, origin_source")
    .eq("stripe_checkout_session_id", sessionId)
    .maybeSingle();
  if (purchase) {
    originUserId = purchase.origin_user_id ?? originUserId;
    originUsername = purchase.origin_username ?? originUsername;
    originSource = purchase.origin_source ?? originSource;
  }

  return {
    ok: true as const,
    mode,
    itemSlug,
    cloneId,
    cloneName,
    tenantId,
    tenantName,
    originUserId,
    originUsername,
    originSource,
    amountTotal: session.amount_total,
    currency: session.currency,
    paymentStatus: session.payment_status,
  };
}

async function fulfillmentStatus(sessionId: string) {
  // Was the webhook event seen + processed?
  const { data: ev } = await adminAny
    .from("stripe_events")
    .select("processed_at, type, error")
    .eq("type", "checkout.session.completed")
    .filter("payload->>id", "eq", sessionId)
    .maybeSingle();

  let mode: string | null = null;
  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId);
    mode = (session.metadata?.mode as string | undefined) ?? null;
  } catch {
    /* ignore */
  }

  let fulfilled = false;
  if (mode === "setup_package") {
    const { data: sp } = await adminAny
      .from("setup_purchases")
      .select("fulfilled_at, status")
      .eq("stripe_checkout_session_id", sessionId)
      .maybeSingle();
    fulfilled = !!sp?.fulfilled_at;
  } else if (mode === "topup") {
    const { data: ledger } = await adminAny
      .from("token_ledger")
      .select("id")
      .eq("source_ref", `stripe:${sessionId}`)
      .limit(1)
      .maybeSingle();
    fulfilled = !!ledger;
  } else if (mode === "seat_plan") {
    // Seat plan is fulfilled when the webhook processed checkout.session.completed
    fulfilled = !!ev?.processed_at && !ev?.error;
  }

  return {
    ok: true as const,
    mode,
    webhookProcessed: !!ev?.processed_at,
    webhookError: ev?.error ?? null,
    fulfilled,
  };
}

export const lookupCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input) => z.object({ sessionId: z.string().min(1).max(200) }).parse(input))
  .handler(async ({ data }) => {
    try {
      return await buildSessionSummary(data.sessionId);
    } catch (err) {
      console.error("lookupCheckoutSession failed", err);
      return { ok: false as const, error: "lookup_failed" };
    }
  });

// Polled by /billing/success to detect when the webhook has finalised
// fulfilment, so the UI can stop showing "your purchase is being finalised".
export const getCheckoutFulfillmentStatus = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input) => z.object({ sessionId: z.string().min(1).max(200) }).parse(input))
  .handler(async ({ data }) => {
    return await fulfillmentStatus(data.sessionId);
  });

const HandoffLookupSchema = z.object({
  sessionId: z.string().min(1).max(200),
  h: z.string().uuid(),
});

/**
 * Non-operator success-page lookup (Phase 3). Authorised by possession of
 * the (session_id, handoff_id) pair; returns the same summary the operator
 * path gets, plus the handoff's return link back to the command center.
 */
export const lookupCheckoutSessionByHandoff = createServerFn({ method: "POST" })
  .inputValidator((input) => HandoffLookupSchema.parse(input))
  .handler(async ({ data }) => {
    try {
      if (!(await sessionMatchesHandoff(data.sessionId, data.h))) {
        return { ok: false as const, error: "not_found" };
      }
      const summary = await buildSessionSummary(data.sessionId);
      const handoff = await loadHandoffById(data.h);
      return {
        ...summary,
        returnUrl: handoff?.return_url ?? null,
      };
    } catch (err) {
      console.error("lookupCheckoutSessionByHandoff failed", err);
      return { ok: false as const, error: "lookup_failed" };
    }
  });

export const getCheckoutFulfillmentStatusByHandoff = createServerFn({ method: "POST" })
  .inputValidator((input) => HandoffLookupSchema.parse(input))
  .handler(async ({ data }) => {
    if (!(await sessionMatchesHandoff(data.sessionId, data.h))) {
      return { ok: false as const, error: "not_found" };
    }
    return await fulfillmentStatus(data.sessionId);
  });
