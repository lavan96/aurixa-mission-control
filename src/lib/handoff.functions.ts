// Resolves a billing handoff token for the pricing/topup pages
// (user-attributed pricing workflow, Phase 2).
//
// No auth middleware: the single-use, expiring token itself is the
// credential (it is minted server-to-server and unguessable). The response
// is deliberately minimal — enough to pin the purchase scope and render the
// "Purchasing for <clone> as <user>" banner, nothing more. The raw
// origin_user_id stays server-side; checkout re-reads it from the handoff row.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadValidHandoff } from "@/server/purchases.server";
import { loadHandoffById } from "@/server/billing-handoffs.server";

export type ResolvedHandoff = {
  ok: true;
  handoffId: string;
  cloneId: string | null;
  cloneName: string | null;
  tenantId: string | null;
  originUsername: string | null;
  intent: string | null;
};

export const resolveHandoff = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ h: z.string().uuid() }).parse(input))
  .handler(async ({ data }): Promise<ResolvedHandoff | { ok: false; error: string }> => {
    const handoff = await loadValidHandoff(data.h);
    if (!handoff) return { ok: false as const, error: "handoff_invalid" };

    let cloneName: string | null = null;
    if (handoff.clone_id) {
      const { data: clone } = await supabaseAdmin
        .from("clones")
        .select("name, slug")
        .eq("id", handoff.clone_id)
        .maybeSingle();
      cloneName = clone?.name ?? clone?.slug ?? null;
    }

    return {
      ok: true as const,
      handoffId: handoff.id,
      cloneId: handoff.clone_id,
      cloneName,
      tenantId: handoff.tenant_id,
      originUsername: handoff.origin_username,
      intent: handoff.intent,
    };
  });

/**
 * Return-link info for the cancel page (Phase 3). By the time a purchaser
 * lands on /billing/cancel the handoff is already consumed, so resolveHandoff
 * would reject it — this fn accepts consumed tokens but exposes only the
 * display-safe "way home": clone name + validated return URL.
 */
export const getHandoffReturnInfo = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ h: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const handoff = await loadHandoffById(data.h);
    if (!handoff) return { ok: false as const, error: "not_found" };

    let cloneName: string | null = null;
    if (handoff.clone_id) {
      const { data: clone } = await supabaseAdmin
        .from("clones")
        .select("name, slug")
        .eq("id", handoff.clone_id)
        .maybeSingle();
      cloneName = clone?.name ?? clone?.slug ?? null;
    }

    return {
      ok: true as const,
      cloneName,
      returnUrl: handoff.return_url,
    };
  });
