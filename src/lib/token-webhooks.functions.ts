import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import crypto from "crypto";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { retryDueDeliveries } from "@/server/token-webhooks.server";

const DEFAULT_EVENTS = [
  "tokens.balance.updated",
  "tokens.key.revoked",
  "tokens.key.rotated",
  "tokens.alert",
] as const;

export const listWebhookEndpoints = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("token_webhook_endpoints")
      .select("id, clone_id, url, events, is_active, created_at, clones:clone_id(id, name, slug)")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { endpoints: data ?? [] };
  });

export const upsertWebhookEndpoint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid().optional(),
        cloneId: z.string().uuid().nullable().optional(),
        url: z.string().url().max(500),
        events: z.array(z.string().min(1).max(64)).min(1).max(10).default([...DEFAULT_EVENTS]),
        isActive: z.boolean().default(true),
        rotateSecret: z.boolean().default(false),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (data.id) {
      const newSecret = data.rotateSecret ? crypto.randomBytes(32).toString("base64url") : undefined;
      const patch = {
        url: data.url,
        events: data.events,
        is_active: data.isActive,
        clone_id: data.cloneId ?? null,
        updated_at: new Date().toISOString(),
        ...(newSecret ? { secret: newSecret } : {}),
      };
      const { error } = await supabaseAdmin.from("token_webhook_endpoints").update(patch).eq("id", data.id);
      if (error) return { ok: false as const, error: error.message };
      return { ok: true as const, secret: newSecret ?? null };
    }
    const secret = crypto.randomBytes(32).toString("base64url");
    const { error } = await supabaseAdmin.from("token_webhook_endpoints").insert({
      url: data.url,
      events: data.events,
      is_active: data.isActive,
      clone_id: data.cloneId ?? null,
      secret,
      created_by: context.userId,
    });
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, secret };
  });

export const deleteWebhookEndpoint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin.from("token_webhook_endpoints").delete().eq("id", data.id);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

export const listWebhookDeliveries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        endpointId: z.string().uuid().optional(),
        status: z.enum(["pending", "delivered", "failed"]).optional(),
        limit: z.number().int().min(1).max(200).default(50),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("token_webhook_deliveries")
      .select(
        "id, endpoint_id, event_type, status, response_code, response_body, attempts, next_attempt_at, delivered_at, created_at, token_webhook_endpoints:endpoint_id(url)",
      )
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.endpointId) q = q.eq("endpoint_id", data.endpointId);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { deliveries: rows ?? [] };
  });

export const retryWebhookDeliveriesNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const r = await retryDueDeliveries();
    return { ok: true as const, ...r };
  });

export const redriveWebhookDelivery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin
      .from("token_webhook_deliveries")
      .update({ status: "pending", next_attempt_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) return { ok: false as const, error: error.message };
    const r = await retryDueDeliveries();
    return { ok: true as const, ...r };
  });
