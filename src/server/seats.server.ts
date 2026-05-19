import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fireTokenWebhook } from "./token-webhooks.server";

/**
 * Fire seat-lifecycle webhooks. Reuses the same delivery infra as token
 * webhooks; endpoints can subscribe to `seats.*` event names alongside
 * `tokens.*` ones.
 */
export async function fireSeatWebhook(
  event:
    | "seats.reserved"
    | "seats.committed"
    | "seats.released"
    | "seats.limit.approaching"
    | "seats.limit.reached"
    | "seats.plan.changed",
  payload: Record<string, unknown>,
  cloneId?: string | null,
) {
  // Re-uses token webhook fanout; cast widens the event union at call site.
  return fireTokenWebhook(event as never, payload, cloneId);
}

/** Lightweight entitlement snapshot for webhook payloads / responses. */
export async function seatEntitlementSnapshot(cloneId: string | null) {
  let entQ = supabaseAdmin.from("clone_seat_entitlements" as never).select("*");
  entQ = cloneId == null ? entQ.is("clone_id", null) : entQ.eq("clone_id", cloneId);
  const { data: ent } = await entQ.maybeSingle();
  if (!ent) return null;
  const { data: plan } = await supabaseAdmin
    .from("seat_plans" as never)
    .select("slug, name, seat_limit, device_limit_per_seat, overage_policy")
    .eq("id", (ent as any).seat_plan_id)
    .maybeSingle();
  return {
    clone_id: cloneId,
    plan,
    seats_used: (ent as any).seats_used,
    seats_remaining: Math.max(0, ((plan as any)?.seat_limit ?? 0) - ((ent as any).seats_used ?? 0)),
    status: (ent as any).status,
  };
}

/** Resolve entitlement + plan for a clone, auto-creating on default plan. */
export async function ensureSeatEntitlement(cloneId: string | null) {
  const snap = await seatEntitlementSnapshot(cloneId);
  if (snap) return snap;
  const { data: defaultPlan } = await supabaseAdmin
    .from("seat_plans" as never)
    .select("id")
    .eq("is_default", true)
    .eq("is_active", true)
    .maybeSingle();
  let planId = (defaultPlan as any)?.id;
  if (!planId) {
    const { data: cheapest } = await supabaseAdmin
      .from("seat_plans" as never)
      .select("id")
      .eq("is_active", true)
      .order("price_cents", { ascending: true })
      .limit(1)
      .maybeSingle();
    planId = (cheapest as any)?.id;
  }
  if (!planId) return null;
  await supabaseAdmin
    .from("clone_seat_entitlements" as never)
    .insert({ clone_id: cloneId, seat_plan_id: planId, seats_used: 0 } as never);
  return seatEntitlementSnapshot(cloneId);
}

/** Emit limit-approaching / limit-reached notifications when thresholds cross. */
export async function checkSeatThresholds(cloneId: string | null) {
  const snap = await seatEntitlementSnapshot(cloneId);
  if (!snap || !snap.plan) return;
  const limit = (snap.plan as any).seat_limit ?? 0;
  if (limit <= 0) return;
  const used = snap.seats_used ?? 0;
  const pct = used / limit;
  if (used >= limit) {
    await supabaseAdmin.from("notifications").insert({
      kind: "seat_limit_reached" as any,
      severity: "error",
      title: `Seat limit reached`,
      body: `${used}/${limit} seats used on plan ${(snap.plan as any).slug}.`,
      clone_id: cloneId,
      url: "/settings/billing",
      metadata: snap as any,
    });
    await fireSeatWebhook("seats.limit.reached", snap as any, cloneId);
  } else if (pct >= 0.8) {
    await supabaseAdmin.from("notifications").insert({
      kind: "seat_limit_approaching" as any,
      severity: "warning",
      title: `Seat usage at ${Math.round(pct * 100)}%`,
      body: `${used}/${limit} seats used on plan ${(snap.plan as any).slug}.`,
      clone_id: cloneId,
      url: "/settings/billing",
      metadata: snap as any,
    });
    await fireSeatWebhook("seats.limit.approaching", snap as any, cloneId);
  }
}
