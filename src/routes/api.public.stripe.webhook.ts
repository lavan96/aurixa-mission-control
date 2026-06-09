// Stripe webhook receiver.
// Verifies the signature, dedupes events, and applies the purchase to our DB.
import { createFileRoute } from "@tanstack/react-router";
import type Stripe from "stripe";
import { getStripe, getStripeCryptoProvider } from "@/server/stripe.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";

function ok(body: unknown = { received: true }) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
function bad(status: number, msg: string) {
  return new Response(msg, { status });
}

// Raised for events that can never succeed (bad/missing metadata, unknown mode,
// inactive pack). We ack these with 200 so Stripe stops retrying, and record the
// reason on the event row. Anything else is treated as transient (see POST).
class PermanentError extends Error {}

async function alreadyProcessed(eventId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("stripe_events")
    .select("processed_at")
    .eq("stripe_event_id", eventId)
    .maybeSingle();
  return !!(data && data.processed_at);
}

async function recordEvent(event: Stripe.Event) {
  await supabaseAdmin.from("stripe_events").upsert(
    {
      stripe_event_id: event.id,
      type: event.type,
      payload: event as unknown as Json,
    },
    { onConflict: "stripe_event_id" },
  );
}

async function markProcessed(eventId: string, error?: string) {
  await supabaseAdmin
    .from("stripe_events")
    .update({ processed_at: new Date().toISOString(), error: error ?? null })
    .eq("stripe_event_id", eventId);
}

// Record a transient failure without setting processed_at, so a Stripe retry
// reprocesses the event.
async function recordTransientError(eventId: string, error: string) {
  await supabaseAdmin.from("stripe_events").update({ error }).eq("stripe_event_id", eventId);
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const md = session.metadata ?? {};
  const mode = md.mode as "topup" | "seat_plan" | "setup_package" | undefined;
  const itemId = md.item_id;
  const tenantId = md.tenant_id || null;
  const cloneId = md.clone_id || null;
  if (!mode || !itemId) throw new PermanentError("missing_metadata");

  if (mode === "topup") {
    if (!tenantId) throw new PermanentError("missing_tenant");
    const { data, error } = await supabaseAdmin.rpc("apply_topup", {
      _tenant_id: tenantId,
      _pack_id: itemId,
      _source_ref: `stripe:${session.id}`,
    });
    if (error) throw new Error(error.message); // transient (DB / RPC failure)
    if (data && typeof data === "object" && (data as { ok?: boolean }).ok === false) {
      // Logical failure from the RPC (e.g. pack_not_found) — retrying won't help.
      throw new PermanentError((data as { error?: string }).error ?? "apply_topup_failed");
    }
    return;
  }

  if (mode === "setup_package") {
    if (!tenantId) throw new PermanentError("missing_tenant");
    const { error } = await supabaseAdmin.from("setup_purchases").upsert(
      {
        tenant_id: tenantId,
        setup_package_id: itemId,
        stripe_checkout_session_id: session.id,
        stripe_payment_intent_id:
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : (session.payment_intent?.id ?? null),
        amount_cents: session.amount_total ?? 0,
        currency: (session.currency ?? "aud").toUpperCase(),
        status: session.payment_status === "paid" ? "paid" : "pending",
        metadata: md as unknown as Json,
      },
      { onConflict: "stripe_checkout_session_id" },
    );
    if (error) throw new Error(error.message); // transient
    return;
  }

  if (mode === "seat_plan") {
    // cloneId null = Prime (global) entitlement.
    const existingQ = cloneId
      ? supabaseAdmin
          .from("clone_seat_entitlements")
          .select("clone_id")
          .eq("clone_id", cloneId)
          .maybeSingle()
      : supabaseAdmin
          .from("clone_seat_entitlements")
          .select("clone_id")
          .is("clone_id", null)
          .maybeSingle();
    const { data: existing, error: existingErr } = await existingQ;
    if (existingErr) throw new Error(existingErr.message); // transient
    if (existing) {
      const updQ = cloneId
        ? supabaseAdmin
            .from("clone_seat_entitlements")
            .update({ seat_plan_id: itemId, updated_at: new Date().toISOString() })
            .eq("clone_id", cloneId)
        : supabaseAdmin
            .from("clone_seat_entitlements")
            .update({ seat_plan_id: itemId, updated_at: new Date().toISOString() })
            .is("clone_id", null);
      const { error } = await updQ;
      if (error) throw new Error(error.message); // transient
    } else {
      const { error } = await supabaseAdmin
        .from("clone_seat_entitlements")
        .insert({ clone_id: cloneId, seat_plan_id: itemId, seats_used: 0 });
      if (error) throw new Error(error.message); // transient
    }
    return;
  }

  throw new PermanentError(`unsupported_mode:${mode}`);
}

export const Route = createFileRoute("/api/public/stripe/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!secret) return bad(500, "webhook_secret_not_configured");

        const sig = request.headers.get("stripe-signature");
        if (!sig) return bad(400, "missing_signature");

        const raw = await request.text();
        let event: Stripe.Event;
        try {
          event = await getStripe().webhooks.constructEventAsync(
            raw,
            sig,
            secret,
            undefined,
            getStripeCryptoProvider(),
          );
        } catch (err) {
          return bad(400, `signature_verification_failed: ${(err as Error).message}`);
        }

        if (await alreadyProcessed(event.id)) return ok({ received: true, duplicate: true });
        await recordEvent(event);

        try {
          if (event.type === "checkout.session.completed") {
            await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
          }
          await markProcessed(event.id);
          return ok();
        } catch (err) {
          const msg = (err as Error).message ?? "handler_error";
          if (err instanceof PermanentError) {
            // Unprocessable event: ack with 200 so Stripe stops retrying, and
            // record the reason on the event row.
            await markProcessed(event.id, msg);
            return ok({ received: true, error: msg });
          }
          // Transient failure (DB/RPC/network): do NOT mark processed and return
          // 5xx so Stripe retries. Handlers are idempotent (apply_topup dedupes
          // on source_ref; the others upsert), so reprocessing is safe.
          await recordTransientError(event.id, msg);
          return bad(500, `transient_error: ${msg}`);
        }
      },
    },
  },
});
