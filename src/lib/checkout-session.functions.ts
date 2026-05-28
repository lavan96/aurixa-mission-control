// Look up a Stripe Checkout Session and resolve the associated clone/item
// so the success page can confirm which client was billed.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getStripe } from "@/server/stripe.server";

export const lookupCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ sessionId: z.string().min(1) }).parse(input))
  .handler(async ({ data }) => {
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
