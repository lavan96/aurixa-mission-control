// Look up a Stripe Checkout Session and resolve the associated clone/item
// so the success page can confirm which client was billed.
//
// Access: callers must be a Mission Control operator. This prevents any
// authenticated user from arbitrarily enumerating other tenants' sessions
// by guessing or harvesting `cs_…` IDs.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getStripe } from "@/server/stripe.server";

async function ensureOperator(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("is_operator", { _user_id: userId });
  if (error) return false;
  return !!data;
}

export const lookupCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ sessionId: z.string().min(1).max(200) }).parse(input))
  .handler(async ({ data, context }) => {
    if (!(await ensureOperator(context.userId))) {
      return { ok: false as const, error: "forbidden" };
    }
    try {
      const session = await getStripe().checkout.sessions.retrieve(data.sessionId);
      const meta = (session.metadata ?? {}) as Record<string, string>;
      const mode = meta.mode ?? null;
      const itemSlug = meta.item_slug ?? null;
      const tenantId = meta.tenant_id || null;
      const cloneId = meta.clone_id || null;

      let cloneName: string | null = null;
      if (cloneId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: clone } = await (supabaseAdmin as any)
          .from("clones").select("name, slug").eq("id", cloneId).maybeSingle();
        cloneName = clone?.name ?? clone?.slug ?? null;
      }

      let tenantName: string | null = null;
      if (!cloneName && tenantId) {
        const { data: tenant } = await supabaseAdmin
          .from("tenants").select("display_name, external_ref").eq("id", tenantId).maybeSingle();
        tenantName = tenant?.display_name ?? tenant?.external_ref ?? null;
      }

      return {
        ok: true as const,
        mode,
        itemSlug,
        cloneId,
        cloneName,
        tenantId,
        tenantName,
        amountTotal: session.amount_total,
        currency: session.currency,
        paymentStatus: session.payment_status,
      };
    } catch (err) {
      console.error("lookupCheckoutSession failed", err);
      return { ok: false as const, error: "lookup_failed" };
    }
  });

// Polled by /billing/success to detect when the webhook has finalised
// fulfilment, so the UI can stop showing "your purchase is being finalised".
export const getCheckoutFulfillmentStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ sessionId: z.string().min(1).max(200) }).parse(input))
  .handler(async ({ data, context }) => {
    if (!(await ensureOperator(context.userId))) {
      return { ok: false as const, error: "forbidden" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adminAny = supabaseAdmin as any;

    // Was the webhook event seen + processed?
    const { data: ev } = await adminAny
      .from("stripe_events")
      .select("processed_at, type, error")
      .eq("type", "checkout.session.completed")
      .filter("payload->>id", "eq", data.sessionId)
      .maybeSingle();

    let mode: string | null = null;
    try {
      const session = await getStripe().checkout.sessions.retrieve(data.sessionId);
      mode = (session.metadata?.mode as string | undefined) ?? null;
    } catch {
      /* ignore */
    }

    let fulfilled = false;
    if (mode === "setup_package") {
      const { data: sp } = await adminAny
        .from("setup_purchases")
        .select("fulfilled_at, status")
        .eq("stripe_checkout_session_id", data.sessionId)
        .maybeSingle();
      fulfilled = !!sp?.fulfilled_at;
    } else if (mode === "topup") {
      const { data: ledger } = await adminAny
        .from("token_ledger")
        .select("id")
        .eq("source_ref", `stripe:${data.sessionId}`)
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
  });
