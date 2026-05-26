-- 1) Add stripe_price_id to catalog tables
ALTER TABLE public.topup_packs     ADD COLUMN IF NOT EXISTS stripe_price_id text;
ALTER TABLE public.seat_plans      ADD COLUMN IF NOT EXISTS stripe_price_id text;
ALTER TABLE public.setup_packages  ADD COLUMN IF NOT EXISTS stripe_price_id text;

CREATE UNIQUE INDEX IF NOT EXISTS topup_packs_stripe_price_id_uidx    ON public.topup_packs(stripe_price_id)    WHERE stripe_price_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS seat_plans_stripe_price_id_uidx     ON public.seat_plans(stripe_price_id)     WHERE stripe_price_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS setup_packages_stripe_price_id_uidx ON public.setup_packages(stripe_price_id) WHERE stripe_price_id IS NOT NULL;

-- 2) tenants.stripe_customer_id
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS stripe_customer_id text;
CREATE UNIQUE INDEX IF NOT EXISTS tenants_stripe_customer_id_uidx ON public.tenants(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- 3) stripe_events: webhook idempotency + audit
CREATE TABLE IF NOT EXISTS public.stripe_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id   text NOT NULL UNIQUE,
  type              text NOT NULL,
  payload           jsonb NOT NULL,
  processed_at      timestamptz,
  error             text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.stripe_events TO authenticated;
GRANT ALL    ON public.stripe_events TO service_role;

ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view stripe_events"
  ON public.stripe_events FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

-- 4) setup_purchases: record one-time setup-package purchases
CREATE TABLE IF NOT EXISTS public.setup_purchases (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  setup_package_id            uuid REFERENCES public.setup_packages(id) ON DELETE SET NULL,
  stripe_checkout_session_id  text UNIQUE,
  stripe_payment_intent_id    text,
  amount_cents                integer,
  currency                    text,
  status                      text NOT NULL DEFAULT 'pending',
  metadata                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS setup_purchases_tenant_idx ON public.setup_purchases(tenant_id);

GRANT SELECT ON public.setup_purchases TO authenticated;
GRANT ALL    ON public.setup_purchases TO service_role;

ALTER TABLE public.setup_purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view setup_purchases"
  ON public.setup_purchases FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE TRIGGER setup_purchases_updated_at
  BEFORE UPDATE ON public.setup_purchases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();