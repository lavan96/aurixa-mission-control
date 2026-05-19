import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonResponse, resolveCloneApiKey } from "@/server/clone-api-keys.server";

export const Route = createFileRoute("/api/public/pricing/catalog")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Any active key is fine — catalog is non-sensitive read.
        const key = await resolveCloneApiKey(request.headers.get("x-clone-api-key"), "tokens:meter");
        const fallback = key
          ? null
          : await resolveCloneApiKey(request.headers.get("x-clone-api-key"), "seats:manage");
        if (!key && !fallback) return jsonResponse({ ok: false, error: "unauthorized" }, 401);

        const [roles, addons, setups, reports, plans, packs] = await Promise.all([
          supabaseAdmin.from("seat_roles" as never).select("slug,name,description,price_min_cents,price_max_cents,currency,permissions,metadata,sort_order").eq("is_active", true).order("sort_order"),
          supabaseAdmin.from("addon_modules" as never).select("slug,name,category,description,price_min_cents,price_max_cents,billing_period,currency,included_in_plans,metadata,sort_order").eq("is_active", true).order("sort_order"),
          supabaseAdmin.from("setup_packages" as never).select("slug,name,description,price_min_cents,price_max_cents,currency,applies_to_plans,deliverables,metadata,sort_order").eq("is_active", true).order("sort_order"),
          supabaseAdmin.from("report_credit_costs" as never).select("slug,name,category,description,credit_cost,metadata,sort_order").eq("is_active", true).order("sort_order"),
          supabaseAdmin.from("seat_plans" as never).select("slug,name,seat_limit,device_limit_per_seat,price_cents,currency,metadata").eq("is_active", true).order("price_cents"),
          supabaseAdmin.from("topup_packs" as never).select("slug,name,tokens,price_cents,currency,metadata").eq("is_active", true).order("price_cents"),
        ]);

        return jsonResponse({
          ok: true,
          roles: roles.data ?? [],
          addons: addons.data ?? [],
          setups: setups.data ?? [],
          reports: reports.data ?? [],
          plans: plans.data ?? [],
          packs: packs.data ?? [],
        });
      },
    },
  },
});
