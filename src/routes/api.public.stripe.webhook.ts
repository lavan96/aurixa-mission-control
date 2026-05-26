// Stripe webhook receiver.
// Verifies the signature, dedupes events, and applies the purchase to our DB.
import { createFileRoute } from "@tanstack/react-router";
import type Stripe from "stripe";
import { getStripe, getStripeCryptoProvider } from "@/server/stripe.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function ok(body: unknown = { received: true }) {
  return new Response(JSON.stringify(body), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
function bad(status: number, msg: string) {
  return new Response(msg, { status });
}

// We use `any` casts for tables created in the latest migration that aren't
// yet in the generated Supabase types file (regenerated on next deploy).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adminAny = supabaseAdmin as any;

async function alreadyProcessed(eventId: string): Promise<boolean> {
  const { data } = await adminAny
    .from("stripe_events")
    .select("id, processed_at")
    .eq("stripe_event_id", eventId)
    .maybeSingle();
  return !!(data && data.processed_at);
}

async function recordEvent(event: Stripe.Event, payload: unknown) {
  await adminAny.from("stripe_events").upsert({
    stripe_event_id: event.id,
    type: event.type,
    payload,
  }, { onConflict: "stripe_event_id" });
}

async function markProcessed(eventId: string, error?: string) {
  await adminAny
    .from("stripe_events")
    .update({ processed_at: new Date().toISOString(), error: error ?? null })
    .eq("stripe_event_id", eventId);
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const md = session.metadata ?? {};
  const mode = md.mode as "topup" | "seat_plan" | "setup_package" | undefined;
  const itemId = md.item_id;
  const tenantId = md.tenant_id || null;
  const cloneId = md.clone_id || null;
  if (!mode || !itemId) throw new Error("missing_metadata");

  if (mode === "topup") {
    if (!tenantId) throw new Error("missing_tenant");
    const { data, error } = await supabaseAdmin.rpc("apply_topup", {
      _tenant_id: tenantId,
      _pack_id: itemId,
      _source_ref: `stripe:${session.id}`,
    });
    if (error) throw new Error(error.message);
    if (data && typeof data === "object" && (data as { ok?: boolean }).ok === false) {
      throw new Error((data as { error?: string }).error ?? "apply_topup_failed");
    }
    return;
  }

  if (mode === "setup_package") {
    if (!tenantId) throw new Error("missing_tenant");
    await adminAny.from("setup_purchases").upsert({
      tenant_id: tenantId,
      setup_package_id: itemId,
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: typeof session.payment_intent === "string"
        ? session.payment_intent : session.payment_intent?.id ?? null,
      amount_cents: session.amount_total ?? 0,
      currency: (session.currency ?? "aud").toUpperCase(),
      status: session.payment_status === "paid" ? "paid" : "pending",
      metadata: md,
    }, { onConflict: "stripe_checkout_session_id" });
    return;
  }

  if (mode === "seat_plan") {
    if (!cloneId) throw new Error("missing_clone");
    // Upsert the entitlement for this clone with the chosen seat plan.
    const { data: existing } = await supabaseAdmin
      .from("clone_seat_entitlements")
      .select("clone_id")
      .eq("clone_id", cloneId).maybeSingle();
    if (existing) {
      await supabaseAdmin
        .from("clone_seat_entitlements")
        .update({ seat_plan_id: itemId, updated_at: new Date().toISOString() })
        .eq("clone_id", cloneId);
    } else {
      await supabaseAdmin
        .from("clone_seat_entitlements")
        .insert({ clone_id: cloneId, seat_plan_id: itemId, seats_used: 0 });
    }
    return;
  }

  throw new Error(`unsupported_mode:${mode}`);
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
            raw, sig, secret, undefined, getStripeCryptoProvider(),
          );
        } catch (err) {
          return bad(400, `signature_verification_failed: ${(err as Error).message}`);
        }

        if (await alreadyProcessed(event.id)) return ok({ received: true, duplicate: true });
        await recordEvent(event, event);

        try {
          if (event.type === "checkout.session.completed") {
            await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
          }
          await markProcessed(event.id);
          return ok();
        } catch (err) {
          const msg = (err as Error).message ?? "handler_error";
          await markProcessed(event.id, msg);
          // 200 on logical errors so Stripe doesn't retry forever; surface via stripe_events.error.
          return ok({ received: true, error: msg });
        }
      },
    },
  },
});
