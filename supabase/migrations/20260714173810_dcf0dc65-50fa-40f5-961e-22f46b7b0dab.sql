-- ============ 20260714120000: relink stripe prices ============
UPDATE public.seat_plans SET stripe_price_id = 'price_1TdPoP3tNhf9apmH6JlU0BL4' WHERE slug = 'launch';
UPDATE public.seat_plans SET stripe_price_id = 'price_1TdPq03tNhf9apmHznBWIvNa' WHERE slug = 'professional';
UPDATE public.seat_plans SET stripe_price_id = 'price_1TdPr63tNhf9apmH0UKbNlRm' WHERE slug = 'growth';
UPDATE public.seat_plans SET stripe_price_id = 'price_1TdPst3tNhf9apmHD7GLzD7K' WHERE slug = 'enterprise';

UPDATE public.topup_packs SET stripe_price_id = 'price_1TdPjT3tNhf9apmHmo7Ii6Hg' WHERE slug = 'credits-50';
UPDATE public.topup_packs SET stripe_price_id = 'price_1TdPlA3tNhf9apmH1poX9bMT' WHERE slug = 'credits-100';
UPDATE public.topup_packs SET stripe_price_id = 'price_1TdPmL3tNhf9apmHPQXva98c' WHERE slug = 'credits-250';
UPDATE public.topup_packs SET stripe_price_id = 'price_1TdPnF3tNhf9apmHagxV1tSf' WHERE slug = 'credits-500';

UPDATE public.setup_packages SET stripe_price_id = 'price_1TdPuK3tNhf9apmH7ORscO4B' WHERE slug = 'launch-onboarding';
UPDATE public.setup_packages SET stripe_price_id = 'price_1TdPvY3tNhf9apmHl4HEDR82' WHERE slug = 'professional-onboarding';
UPDATE public.setup_packages SET stripe_price_id = 'price_1TdPwZ3tNhf9apmH4uadT3BE' WHERE slug = 'growth-onboarding';

UPDATE public.setup_packages t
   SET stripe_price_id = 'price_1TdPy13tNhf9apmHLPgmKlD6'
 WHERE t.slug = 'enterprise-onboarding'
   AND NOT EXISTS (
     SELECT 1 FROM public.setup_packages o
      WHERE o.stripe_price_id = 'price_1TdPy13tNhf9apmHLPgmKlD6' AND o.id <> t.id
   );

-- ============ 20260714130000: billing_user_id columns ============
ALTER TABLE public.clones  ADD COLUMN IF NOT EXISTS billing_user_id text;
ALTER TABLE public.clones  ADD COLUMN IF NOT EXISTS billing_stripe_customer_id text;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS billing_user_id text;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS billing_stripe_customer_id text;

CREATE UNIQUE INDEX IF NOT EXISTS clones_billing_user_id_uidx
  ON public.clones (billing_user_id)  WHERE billing_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tenants_billing_user_id_uidx
  ON public.tenants (billing_user_id) WHERE billing_user_id IS NOT NULL;

COMMENT ON COLUMN public.clones.billing_user_id IS
  'Operator-assigned tracking user id. The ?uid= key the storefront pricing page checks out against; copied onto the clone''s tenant on first provision.';
COMMENT ON COLUMN public.tenants.billing_user_id IS
  'Tracking user id copied from the owning clone. Stamped into Stripe session metadata + the purchases ledger so payments/products attribute to this tenant.';

-- ============ 20260714140000: sync displayed prices ============
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

UPDATE public.topup_packs SET price_cents = 37500,  tokens = 50,  currency = 'AUD'
  WHERE stripe_price_id = 'price_1TdPjT3tNhf9apmHmo7Ii6Hg';
UPDATE public.topup_packs SET price_cents = 67500,  tokens = 100, currency = 'AUD'
  WHERE stripe_price_id = 'price_1TdPlA3tNhf9apmH1poX9bMT';
UPDATE public.topup_packs SET price_cents = 150000, tokens = 250, currency = 'AUD'
  WHERE stripe_price_id = 'price_1TdPmL3tNhf9apmHPQXva98c';
UPDATE public.topup_packs SET price_cents = 262500, tokens = 500, currency = 'AUD'
  WHERE stripe_price_id = 'price_1TdPnF3tNhf9apmHagxV1tSf';

UPDATE public.setup_packages SET price_min_cents = 300000,   price_max_cents = 300000,   currency = 'AUD'
  WHERE stripe_price_id = 'price_1TdPuK3tNhf9apmH7ORscO4B';
UPDATE public.setup_packages SET price_min_cents = 1000000,  price_max_cents = 1000000,  currency = 'AUD'
  WHERE stripe_price_id = 'price_1TdPvY3tNhf9apmHl4HEDR82';
UPDATE public.setup_packages SET price_min_cents = 2500000,  price_max_cents = 2500000,  currency = 'AUD'
  WHERE stripe_price_id = 'price_1TdPwZ3tNhf9apmH4uadT3BE';
UPDATE public.setup_packages SET price_min_cents = 10000000, price_max_cents = 10000000, currency = 'AUD'
  WHERE stripe_price_id = 'price_1TdPy13tNhf9apmHLPgmKlD6';

-- ============ 20260714171500: token ledger unit repair + clamped balance ============
UPDATE public.token_ledger
SET metadata = COALESCE(metadata, '{}'::jsonb)
      || jsonb_build_object('unit_corrected', true, 'original_tokens', tokens, 'corrected_at', now()),
    tokens = (SIGN(tokens) * CEIL(ABS(tokens) / 1000.0))::int
WHERE kind = 'debit'
  AND ABS(tokens) >= 1000
  AND created_at < TIMESTAMPTZ '2026-07-14 16:17:00+00'
  AND (metadata ->> 'unit_corrected') IS NULL;

UPDATE public.report_jobs
SET charged_tokens = CEIL(charged_tokens / 1000.0)::int
WHERE charged_tokens >= 1000
  AND completed_at < TIMESTAMPTZ '2026-07-14 16:17:00+00';

CREATE OR REPLACE FUNCTION public.recompute_token_balance(_tenant_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row RECORD;
  _running BIGINT := 0;
  _reserved INTEGER;
  _granted BIGINT := 0;
  _spent BIGINT := 0;
BEGIN
  FOR _row IN
    SELECT kind, tokens FROM public.token_ledger
    WHERE tenant_id = _tenant_id
      AND (expires_at IS NULL OR expires_at > now())
      AND kind IN ('grant', 'topup', 'refund', 'adjustment', 'debit', 'expiry')
    ORDER BY created_at, id
  LOOP
    IF _row.kind IN ('grant', 'topup', 'refund', 'adjustment') THEN
      _running := GREATEST(0, _running + _row.tokens);
      IF _row.kind IN ('grant', 'topup') THEN
        _granted := _granted + _row.tokens;
      END IF;
    ELSE
      _running := GREATEST(0, _running - ABS(_row.tokens));
      IF _row.kind = 'debit' THEN
        _spent := _spent + ABS(_row.tokens);
      END IF;
    END IF;
  END LOOP;

  SELECT COALESCE(SUM(CASE
      WHEN kind = 'reserve' THEN ABS(tokens)
      WHEN kind = 'release' THEN -ABS(tokens)
      WHEN kind = 'debit' AND report_job_id IS NOT NULL THEN -ABS(tokens)
      ELSE 0
    END), 0)
  INTO _reserved
  FROM public.token_ledger
  WHERE tenant_id = _tenant_id AND (expires_at IS NULL OR expires_at > now());
  _reserved := GREATEST(0, _reserved);

  INSERT INTO public.token_balances (tenant_id, available, reserved, lifetime_granted, lifetime_spent, updated_at)
  VALUES (
    _tenant_id,
    GREATEST(0, LEAST(_running - _reserved, 2147483647))::int,
    _reserved,
    LEAST(_granted, 2147483647)::int,
    LEAST(_spent, 2147483647)::int,
    now()
  )
  ON CONFLICT (tenant_id) DO UPDATE
    SET available = EXCLUDED.available,
        reserved = EXCLUDED.reserved,
        lifetime_granted = EXCLUDED.lifetime_granted,
        lifetime_spent = EXCLUDED.lifetime_spent,
        updated_at = now();
END;
$$;

DO $$
DECLARE _t UUID;
BEGIN
  FOR _t IN SELECT DISTINCT tenant_id FROM public.token_ledger LOOP
    PERFORM public.recompute_token_balance(_t);
  END LOOP;
END;
$$;

-- ============ 20260714180000: seed prime billing_user_id ============
UPDATE public.tenants
   SET billing_user_id = 'npc-prime'
 WHERE external_ref = 'prime:dduzbchuswwbefdunfct'
   AND billing_user_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.tenants t2 WHERE t2.billing_user_id = 'npc-prime');
