// Look up a Stripe Checkout Session and resolve the associated clone/item
// so the success page can confirm which client was billed. The heavy lifting
// lives in src/server/checkout-session.server.ts (shared with the storefront
// REST endpoint that powers the Aurixa Systems website's receipt page).
//
// Access — two paths:
//   1. Mission Control operators (requireOperator), which prevents any
//      authenticated user from arbitrarily enumerating other tenants'
//      sessions by guessing or harvesting `cs_…` IDs.
//   2. Handoff holders (no login): the caller must present the session id
//      AND the matching handoff id — the pair only ever exists in the
//      redirect URL Stripe sent that purchaser to.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOperator } from "@/integrations/supabase/role-middleware";
import { loadHandoffById } from "@/server/billing-handoffs.server";
import {
  buildSessionSummary,
  fulfillmentStatus,
  sessionMatchesHandoff,
} from "@/server/checkout-session.server";

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
 * Non-operator success-page lookup. Authorised by possession of the
 * (session_id, handoff_id) pair; returns the same summary the operator path
 * gets, plus the handoff's return link back to the command center.
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
