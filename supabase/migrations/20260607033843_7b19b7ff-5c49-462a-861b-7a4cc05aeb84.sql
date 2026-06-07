-- ============================================================
-- Sprint 1: Security + Billing hardening
-- ============================================================

-- 1) PROFILES: lock down cross-tenant PII exposure.
DROP POLICY IF EXISTS "Profiles viewable by authenticated" ON public.profiles;
CREATE POLICY "Profiles viewable by self or operators"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    OR public.is_operator(auth.uid())
  );

-- Re-affirm INSERT WITH CHECK (it already exists, but make idempotent)
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- 2) SETUP_PURCHASES: fulfillment + refund tracking.
ALTER TABLE public.setup_purchases
  ADD COLUMN IF NOT EXISTS fulfilled_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refunded_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refund_amount_cents INTEGER,
  ADD COLUMN IF NOT EXISTS stripe_charge_id  TEXT;

CREATE INDEX IF NOT EXISTS idx_setup_purchases_charge
  ON public.setup_purchases (stripe_charge_id)
  WHERE stripe_charge_id IS NOT NULL;

-- Defense-in-depth: explicit service_role write policies.
DROP POLICY IF EXISTS "Service role writes setup_purchases" ON public.setup_purchases;
CREATE POLICY "Service role writes setup_purchases"
  ON public.setup_purchases
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role writes stripe_events" ON public.stripe_events;
CREATE POLICY "Service role writes stripe_events"
  ON public.stripe_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 3) CLONE_SEAT_ENTITLEMENTS: subscription lifecycle linkage.
ALTER TABLE public.clone_seat_entitlements
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_customer_id     TEXT,
  ADD COLUMN IF NOT EXISTS current_period_end     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS past_due_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS canceled_at            TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS clone_seat_entitlements_sub_unique
  ON public.clone_seat_entitlements (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clone_seat_entitlements_customer
  ON public.clone_seat_entitlements (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- 4) Helper to find an entitlement by stripe subscription, used by webhook.
CREATE OR REPLACE FUNCTION public.entitlement_for_subscription(_sub_id TEXT)
RETURNS TABLE (id UUID, clone_id UUID, status TEXT, seat_plan_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, clone_id, status, seat_plan_id
  FROM public.clone_seat_entitlements
  WHERE stripe_subscription_id = _sub_id
$$;

-- 5) RESCHEDULE pg_cron JOBS WITH BEARER AUTH FROM VAULT.
-- Requires Vault entry named 'cron_secret' (operator must add this; same
-- value as runtime secret DRIFT_REFRESH_TOKEN). Until present, cron will 401.
DO $$
DECLARE
  v_secret TEXT;
  v_headers TEXT;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'cron_secret'
  LIMIT 1;

  IF v_secret IS NULL THEN
    RAISE NOTICE 'Vault entry cron_secret not found; skipping cron reschedule. Add it and re-run cron.schedule manually.';
    RETURN;
  END IF;

  v_headers := jsonb_build_object(
    'Content-Type','application/json',
    'Authorization','Bearer ' || v_secret
  )::text;

  PERFORM cron.unschedule('expire-reservations-5min')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='expire-reservations-5min');
  PERFORM cron.unschedule('token-alerts-15min')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='token-alerts-15min');
  PERFORM cron.unschedule('brand-drift-30min')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='brand-drift-30min');
  PERFORM cron.unschedule('warm-health-5min')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='warm-health-5min');
  PERFORM cron.unschedule('run-schedules-1min')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='run-schedules-1min');
  PERFORM cron.unschedule('fleet-drift-15min')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='fleet-drift-15min');

  PERFORM cron.schedule(
    'expire-reservations-5min', '*/5 * * * *',
    format($f$SELECT net.http_post(
      url:='https://aurixa-mission-control.lovable.app/hooks/expire-reservations',
      headers:=%L::jsonb, body:='{}'::jsonb)$f$, v_headers)
  );
  PERFORM cron.schedule(
    'token-alerts-15min', '*/15 * * * *',
    format($f$SELECT net.http_post(
      url:='https://aurixa-mission-control.lovable.app/hooks/token-alerts',
      headers:=%L::jsonb, body:='{}'::jsonb)$f$, v_headers)
  );
  PERFORM cron.schedule(
    'brand-drift-30min', '*/30 * * * *',
    format($f$SELECT net.http_post(
      url:='https://aurixa-mission-control.lovable.app/hooks/brand-drift',
      headers:=%L::jsonb, body:='{}'::jsonb)$f$, v_headers)
  );
  PERFORM cron.schedule(
    'warm-health-5min', '*/5 * * * *',
    format($f$SELECT net.http_post(
      url:='https://aurixa-mission-control.lovable.app/hooks/warm-health',
      headers:=%L::jsonb, body:='{}'::jsonb)$f$, v_headers)
  );
  PERFORM cron.schedule(
    'run-schedules-1min', '* * * * *',
    format($f$SELECT net.http_post(
      url:='https://aurixa-mission-control.lovable.app/hooks/run-schedules',
      headers:=%L::jsonb, body:='{}'::jsonb)$f$, v_headers)
  );
  PERFORM cron.schedule(
    'fleet-drift-15min', '*/15 * * * *',
    format($f$SELECT net.http_post(
      url:='https://aurixa-mission-control.lovable.app/hooks/fleet-drift',
      headers:=%L::jsonb, body:='{}'::jsonb)$f$, v_headers)
  );
END $$;
