// @ts-nocheck
// Lists clones the signed-in operator can purchase billing items for.
// Mission Control / Prime is represented client-side as the synthetic
// `null` cloneId option.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type PurchasableClone = {
  id: string;
  name: string;
  slug: string | null;
  deploy_url: string | null;
};

export const listPurchasableClones = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("clones")
      .select("id, name, slug, deploy_url")
      .order("name", { ascending: true });
    if (error)
      return { ok: false as const, error: error.message, clones: [] as PurchasableClone[] };
    return { ok: true as const, clones: (data ?? []) as PurchasableClone[] };
  });