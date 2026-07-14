-- Relink storefront catalog packages/plans to their Stripe prices.
--
-- Source of truth: the Aurixa Systems live Stripe account price export
-- (prices_1.csv, generated 2026-06-01) — every price_id below was verified
-- against the live account. Idempotent: each statement matches on the item's
-- slug, so re-running is a no-op for already-correct rows and touches nothing
-- for slugs that do not exist.
--
-- Why this exists: storefront checkout (startCheckoutCore) rejects any item
-- whose stripe_price_id IS NULL with 'stripe_price_not_linked', so an unlinked
-- package is unpurchasable on the pricing page.
--
-- Delta vs the prior link migration (20260601073134): the enterprise
-- onboarding package is linked under its canonical slug 'enterprise-onboarding'
-- (the slug carried in the Stripe product's metadata and in the catalog
-- export), rather than 'enterprise-whitelabel'.

-- ── Seat plans (recurring subscription prices) ───────────────────────────────
UPDATE public.seat_plans SET stripe_price_id = 'price_1TdPoP3tNhf9apmH6JlU0BL4' WHERE slug = 'launch';
UPDATE public.seat_plans SET stripe_price_id = 'price_1TdPq03tNhf9apmHznBWIvNa' WHERE slug = 'professional';
UPDATE public.seat_plans SET stripe_price_id = 'price_1TdPr63tNhf9apmH0UKbNlRm' WHERE slug = 'growth';
UPDATE public.seat_plans SET stripe_price_id = 'price_1TdPst3tNhf9apmHD7GLzD7K' WHERE slug = 'enterprise';

-- ── Credit packs (one-time prices) ───────────────────────────────────────────
UPDATE public.topup_packs SET stripe_price_id = 'price_1TdPjT3tNhf9apmHmo7Ii6Hg' WHERE slug = 'credits-50';
UPDATE public.topup_packs SET stripe_price_id = 'price_1TdPlA3tNhf9apmH1poX9bMT' WHERE slug = 'credits-100';
UPDATE public.topup_packs SET stripe_price_id = 'price_1TdPmL3tNhf9apmHPQXva98c' WHERE slug = 'credits-250';
UPDATE public.topup_packs SET stripe_price_id = 'price_1TdPnF3tNhf9apmHagxV1tSf' WHERE slug = 'credits-500';

-- ── Setup / onboarding packages (one-time prices) ────────────────────────────
UPDATE public.setup_packages SET stripe_price_id = 'price_1TdPuK3tNhf9apmH7ORscO4B' WHERE slug = 'launch-onboarding';
UPDATE public.setup_packages SET stripe_price_id = 'price_1TdPvY3tNhf9apmHl4HEDR82' WHERE slug = 'professional-onboarding';
UPDATE public.setup_packages SET stripe_price_id = 'price_1TdPwZ3tNhf9apmH4uadT3BE' WHERE slug = 'growth-onboarding';

-- Enterprise onboarding: link under the canonical slug. The NOT EXISTS guard
-- keeps this safe against the setup_packages(stripe_price_id) unique index in
-- the (unexpected) case that a legacy 'enterprise-whitelabel' row still holds
-- this price — in that case the row is left as-is and surfaced by the audit
-- block below rather than failing the migration.
UPDATE public.setup_packages t
   SET stripe_price_id = 'price_1TdPy13tNhf9apmHLPgmKlD6'
 WHERE t.slug = 'enterprise-onboarding'
   AND NOT EXISTS (
     SELECT 1 FROM public.setup_packages o
      WHERE o.stripe_price_id = 'price_1TdPy13tNhf9apmHLPgmKlD6'
        AND o.id <> t.id
   );

-- ── Audit: warn (do not fail) on any active catalog item left unlinked ────────
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT 'seat_plan'     AS kind, slug FROM public.seat_plans     WHERE is_active AND stripe_price_id IS NULL
    UNION ALL
    SELECT 'topup_pack'    AS kind, slug FROM public.topup_packs    WHERE is_active AND stripe_price_id IS NULL
    UNION ALL
    SELECT 'setup_package' AS kind, slug FROM public.setup_packages WHERE is_active AND stripe_price_id IS NULL
    ORDER BY 1, 2
  LOOP
    RAISE WARNING 'Catalog item still unlinked to a Stripe price: % / %', r.kind, r.slug;
  END LOOP;
END $$;
