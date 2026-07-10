-- User-attributed pricing workflow — Phase 1
-- (docs/user-tracking-pricing-workflow-plan.md §3.3, §4 Phase 1)
--
-- 1) billing_handoffs: single-use, expiring identity carrier minted
--    server-to-server under a clone API key. Consumed by the Phase 2 handoff
--    API; created now so purchases.handoff_id can reference it from day one.
-- 2) purchases: unified purchase-attribution ledger across topup / seat_plan /
--    setup_package checkouts. Fulfilment stays in token_ledger /
--    setup_purchases / clone_seat_entitlements; this table answers
--    "who bought what, from where, when".
-- 3) apply_topup: gains an attribution metadata parameter written onto the
--    ledger row.
-- 4) notification_kind: new 'purchase_completed' value.

-- ─── billing_handoffs ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.billing_handoffs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clone_id        uuid REFERENCES public.clones(id) ON DELETE CASCADE,
  tenant_id       uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  origin_user_id  text NOT NULL,
  origin_username text,
  origin_source   text NOT NULL,                 -- 'clone:<slug>' | 'prime:<ref>' | 'aurixa_site'
  intent          text,                          -- optional '<mode>:<item_id>' auto-launch hint
  return_url      text,                          -- "back to your dashboard" target after success
  expires_at      timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  consumed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_handoffs_expiry_idx
  ON public.billing_handoffs(expires_at);

ALTER TABLE public.billing_handoffs ENABLE ROW LEVEL SECURITY;
-- No client policies: reads/writes go through the service role only (the
-- public handoff API and the checkout server functions).
REVOKE ALL ON public.billing_handoffs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.billing_handoffs TO service_role;

-- ─── purchases ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.purchases (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_checkout_session_id  text UNIQUE,
  stripe_payment_intent_id    text,
  stripe_subscription_id      text,
  mode                        text NOT NULL,     -- 'topup' | 'seat_plan' | 'setup_package'
  item_id                     uuid,
  item_slug                   text,
  quantity                    integer NOT NULL DEFAULT 1,
  clone_id                    uuid REFERENCES public.clones(id) ON DELETE SET NULL,
  tenant_id                   uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  handoff_id                  uuid REFERENCES public.billing_handoffs(id) ON DELETE SET NULL,
  -- origin_user_id references a *foreign* auth system (a clone's custom_users
  -- table) so it is text, not a FK. For operator purchases it holds auth.uid().
  origin_user_id              text,
  origin_username             text,
  origin_source               text NOT NULL DEFAULT 'mission_control',
  amount_cents                integer,
  currency                    text,
  payment_status              text,
  status                      text NOT NULL DEFAULT 'initiated'
    CHECK (status IN ('initiated', 'completed', 'failed', 'refunded', 'abandoned')),
  metadata                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  completed_at                timestamptz,
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS purchases_clone_idx  ON public.purchases(clone_id, created_at DESC);
CREATE INDEX IF NOT EXISTS purchases_tenant_idx ON public.purchases(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS purchases_user_idx   ON public.purchases(origin_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS purchases_status_idx ON public.purchases(status);

CREATE TRIGGER purchases_updated_at
  BEFORE UPDATE ON public.purchases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators read purchases" ON public.purchases
  FOR SELECT TO authenticated USING (public.is_operator(auth.uid()));
-- Writes via service role only (checkout server fn + Stripe webhook).
GRANT SELECT ON public.purchases TO authenticated;
GRANT ALL    ON public.purchases TO service_role;

-- ─── apply_topup: attribution metadata onto the ledger row ──────────────────
-- Replace (not overload) the 3-arg version so RPC name resolution stays
-- unambiguous; existing callers omit _metadata and get the default.
DROP FUNCTION IF EXISTS public.apply_topup(UUID, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.apply_topup(
  _tenant_id UUID, _pack_id UUID, _source_ref TEXT DEFAULT NULL,
  _metadata JSONB DEFAULT '{}'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _pack public.topup_packs%ROWTYPE; _expires TIMESTAMPTZ;
BEGIN
  SELECT * INTO _pack FROM public.topup_packs WHERE id = _pack_id AND is_active = true;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'pack_not_found'); END IF;

  -- Idempotency: a topup for this external reference (e.g. a Stripe checkout
  -- session) was already applied. Do not grant the pack twice on a retried
  -- webhook delivery.
  IF _source_ref IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.token_ledger
     WHERE tenant_id = _tenant_id AND kind = 'topup' AND source_ref = _source_ref
  ) THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'tokens', _pack.tokens);
  END IF;

  IF _pack.expires_after_days IS NOT NULL THEN
    _expires := now() + make_interval(days => _pack.expires_after_days);
  END IF;
  INSERT INTO public.token_ledger
    (tenant_id, kind, tokens, source, source_ref, reason, expires_at, created_by, metadata)
  VALUES
    (_tenant_id, 'topup', _pack.tokens, 'topup', COALESCE(_source_ref, _pack.slug),
     'topup_' || _pack.slug, _expires, auth.uid(), COALESCE(_metadata, '{}'::jsonb));
  RETURN jsonb_build_object('ok', true, 'tokens', _pack.tokens, 'expires_at', _expires);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_topup(UUID, UUID, TEXT, JSONB) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.apply_topup(UUID, UUID, TEXT, JSONB) TO authenticated, service_role;

-- ─── notifications: purchase_completed kind ─────────────────────────────────
ALTER TYPE public.notification_kind ADD VALUE IF NOT EXISTS 'purchase_completed';
