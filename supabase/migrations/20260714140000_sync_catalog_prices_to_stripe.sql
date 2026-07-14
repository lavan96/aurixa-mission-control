-- Sync the storefront catalog's displayed prices (and credit-pack sizes) to the
-- live Stripe price amounts, so the pricing page never shows an amount that
-- differs from what Stripe actually charges.
--
-- Source of truth: the Aurixa Systems live price export (prices_1.csv,
-- 2026-06-01), all AUD. Rows are matched by stripe_price_id — set by the relink
-- migration (20260714120000), which must run first — so this is independent of
-- catalog slugs and only ever touches the row that charges that exact price.

-- ── Seat plans (monthly subscription amount) ─────────────────────────────────
-- Also strip any stale price_min/max_cents from metadata so the pricing page
-- falls back to the exact price_cents (no misleading "from X" range on a plan
-- that maps to a single Stripe price).
UPDATE public.seat_plans SET price_cents = 74900,   currency = 'AUD',
  metadata = COALESCE(metadata, '{}'::jsonb) - 'price_min_cents' - 'price_max_cents'
  WHERE stripe_price_id = 'price_1TdPoP3tNhf9apmH6JlU0BL4';
UPDATE public.seat_plans SET price_cents = 275000,  currency = 'AUD',
  metadata = COALESCE(metadata, '{}'::jsonb) - 'price_min_cents' - 'price_max_cents'
  WHERE stripe_price_id = 'price_1TdPq03tNhf9apmHznBWIvNa';
UPDATE public.seat_plans SET price_cents = 650000,  currency = 'AUD',
  metadata = COALESCE(metadata, '{}'::jsonb) - 'price_min_cents' - 'price_max_cents'
  WHERE stripe_price_id = 'price_1TdPr63tNhf9apmH0UKbNlRm';
UPDATE public.seat_plans SET price_cents = 1750000, currency = 'AUD',
  metadata = COALESCE(metadata, '{}'::jsonb) - 'price_min_cents' - 'price_max_cents'
  WHERE stripe_price_id = 'price_1TdPst3tNhf9apmHD7GLzD7K';

-- ── Credit packs (price + credits granted) ───────────────────────────────────
-- `tokens` is the credit count the pack grants (billing-credit units), matching
-- the product name (e.g. "50 Credit Pack" → 50 credits).
UPDATE public.topup_packs SET price_cents = 37500,  tokens = 50,  currency = 'AUD'
  WHERE stripe_price_id = 'price_1TdPjT3tNhf9apmHmo7Ii6Hg';
UPDATE public.topup_packs SET price_cents = 67500,  tokens = 100, currency = 'AUD'
  WHERE stripe_price_id = 'price_1TdPlA3tNhf9apmH1poX9bMT';
UPDATE public.topup_packs SET price_cents = 150000, tokens = 250, currency = 'AUD'
  WHERE stripe_price_id = 'price_1TdPmL3tNhf9apmHPQXva98c';
UPDATE public.topup_packs SET price_cents = 262500, tokens = 500, currency = 'AUD'
  WHERE stripe_price_id = 'price_1TdPnF3tNhf9apmHagxV1tSf';

-- ── Setup / onboarding packages (fixed price → collapse the display range) ────
UPDATE public.setup_packages SET price_min_cents = 300000,   price_max_cents = 300000,   currency = 'AUD'
  WHERE stripe_price_id = 'price_1TdPuK3tNhf9apmH7ORscO4B';
UPDATE public.setup_packages SET price_min_cents = 1000000,  price_max_cents = 1000000,  currency = 'AUD'
  WHERE stripe_price_id = 'price_1TdPvY3tNhf9apmHl4HEDR82';
UPDATE public.setup_packages SET price_min_cents = 2500000,  price_max_cents = 2500000,  currency = 'AUD'
  WHERE stripe_price_id = 'price_1TdPwZ3tNhf9apmH4uadT3BE';
UPDATE public.setup_packages SET price_min_cents = 10000000, price_max_cents = 10000000, currency = 'AUD'
  WHERE stripe_price_id = 'price_1TdPy13tNhf9apmHLPgmKlD6';

-- ── Audit: warn on any active priced item still not linked to a Stripe price ──
-- (Those rows keep their old displayed price until linked — surface them.)
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
    RAISE WARNING 'Priced catalog item has no Stripe link; displayed price left unchanged: % / %', r.kind, r.slug;
  END LOOP;
END $$;
