// G7 — per-clone Stripe webhook receiver.
//
// External Stripe accounts (isolated / handed-off clones running on their own
// backend, or client-owned Stripe accounts) point their webhook here. We
// look up the clone's stripe config, verify the signature with the per-clone
// webhook secret (decrypted just for this request), dedupe the event using
// the shared stripe_events table (scoped by clone_id + stripe_event_id), and
// then either (a) forward the verified event to the client's backend
// `forward_url`, or (b) drop with a "no-fulfilment" ack for 'own_account'
// configs that don't need our platform fulfilment path.
//
// This route deliberately does NOT run our platform fulfilment code
// (topups, seat upserts, etc.) — those live in
// /api/public/stripe/webhook. A future round wires per-clone fulfilment
// once the clone side has a matching /hooks/stripe endpoint of its own.
import { createFileRoute } from "@tanstack/react-router";
import type Stripe from "stripe";
import type { Json } from "@/integrations/supabase/types";
import { getStripe, getStripeCryptoProvider } from "@/server/stripe.server";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/stripe/webhook/$cloneId")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const cloneId = params.cloneId;
        if (!/^[0-9a-f-]{36}$/i.test(cloneId)) {
          return json({ error: "invalid_clone_id" }, 400);
        }

        // Client.server import is scoped to the handler body so the route file
        // stays out of the client bundle graph.
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { decryptSecret } = await import("@/server/crypto.server");

        const { data: config, error: configErr } = await supabaseAdmin
          .from("clone_stripe_configs")
          .select(
            "clone_id, mode, stripe_account_id, webhook_secret_ciphertext, forward_url, status",
          )
          .eq("clone_id", cloneId)
          .maybeSingle();
        if (configErr) return json({ error: "config_lookup_failed" }, 500);
        if (!config) return json({ error: "config_not_found" }, 404);
        if (config.status !== "active" || !config.webhook_secret_ciphertext) {
          return json({ error: "config_not_active", status: config.status }, 409);
        }

        const sig = request.headers.get("stripe-signature");
        if (!sig) return json({ error: "missing_signature" }, 400);

        const raw = await request.text();
        let secret: string;
        try {
          secret = decryptSecret(config.webhook_secret_ciphertext as string) as string;
        } catch (err) {
          return json(
            { error: "webhook_secret_decrypt_failed", detail: (err as Error).message },
            500,
          );
        }

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
          return json(
            { error: "signature_verification_failed", detail: (err as Error).message },
            400,
          );
        }

        // Idempotency claim via stripe_events unique index. clone_id + account
        // are stamped for attribution; the unique key is still stripe_event_id.
        const claimRes = await supabaseAdmin.from("stripe_events").insert({
          stripe_event_id: event.id,
          type: event.type,
          payload: event as unknown as Json,
          clone_id: cloneId,
          stripe_account_id: config.stripe_account_id ?? event.account ?? null,
        });
        if (claimRes.error) {
          if (claimRes.error.code === "23505") {
            const { data: existing } = await supabaseAdmin
              .from("stripe_events")
              .select("processed_at")
              .eq("stripe_event_id", event.id)
              .maybeSingle();
            if (existing?.processed_at) {
              return json({ received: true, duplicate: true });
            }
            // else: fall through and reprocess
          } else {
            return json({ error: "claim_failed", detail: claimRes.error.message }, 500);
          }
        }

        // Best-effort forward to the client backend. Failure = 5xx so Stripe
        // retries; success (2xx / 4xx from downstream) = mark processed.
        let forwardStatus: number | null = null;
        let forwardBody: string | null = null;
        if (config.forward_url) {
          try {
            const forwardRes = await fetch(config.forward_url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Aurixa-Clone-Id": cloneId,
                "X-Aurixa-Stripe-Event-Id": event.id,
                "X-Aurixa-Stripe-Event-Type": event.type,
              },
              body: raw,
            });
            forwardStatus = forwardRes.status;
            forwardBody = (await forwardRes.text()).slice(0, 4000);
            if (forwardRes.status >= 500) {
              await supabaseAdmin
                .from("stripe_events")
                .update({
                  error: `forward_failed:${forwardStatus}:${forwardBody}`,
                })
                .eq("stripe_event_id", event.id);
              return json(
                { error: "forward_failed", status: forwardStatus, body: forwardBody },
                502,
              );
            }
          } catch (err) {
            const msg = (err as Error).message ?? "forward_error";
            await supabaseAdmin
              .from("stripe_events")
              .update({ error: `forward_transient:${msg}` })
              .eq("stripe_event_id", event.id);
            return json({ error: "forward_transient", detail: msg }, 500);
          }
        }

        await supabaseAdmin
          .from("stripe_events")
          .update({
            processed_at: new Date().toISOString(),
            error: forwardStatus && forwardStatus >= 400 ? `forward_${forwardStatus}` : null,
          })
          .eq("stripe_event_id", event.id);

        await supabaseAdmin.from("audit_log").insert({
          action: `stripe.clone.${event.type}`,
          entity_type: "clone",
          entity_id: cloneId,
          metadata: {
            id: event.id,
            forward_status: forwardStatus,
            forwarded: Boolean(config.forward_url),
            stripe_account_id: config.stripe_account_id ?? event.account ?? null,
          },
        });

        return json({
          received: true,
          forwarded: Boolean(config.forward_url),
          forward_status: forwardStatus,
        });
      },
    },
  },
});
