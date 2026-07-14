-- Token ledger correctness
CREATE OR REPLACE FUNCTION public.reserve_tokens(
  _tenant_id UUID, _clone_id UUID, _kind TEXT, _estimated_tokens INTEGER,
  _idempotency_key TEXT, _ttl_seconds INTEGER DEFAULT 600,
  _request_payload JSONB DEFAULT '{}'::jsonb
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _existing public.report_jobs%ROWTYPE;
  _job_id UUID;
  _available INTEGER;
  _plan_overage public.overage_policy;
BEGIN
  IF _estimated_tokens IS NULL OR _estimated_tokens < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_estimate');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_tenant_id::text, 0));
  SELECT * INTO _existing FROM public.report_jobs
   WHERE clone_id = _clone_id AND idempotency_key = _idempotency_key LIMIT 1;
  IF FOUND THEN
    SELECT available INTO _available FROM public.token_balances WHERE tenant_id = _existing.tenant_id;
    RETURN jsonb_build_object('ok', true, 'job_id', _existing.id,
      'reserved_tokens', _existing.estimated_tokens,
      'available_after', COALESCE(_available, 0),
      'idempotent', true, 'status', _existing.status);
  END IF;
  PERFORM public.recompute_token_balance(_tenant_id);
  SELECT available INTO _available FROM public.token_balances WHERE tenant_id = _tenant_id;
  _available := COALESCE(_available, 0);
  SELECT bp.overage_policy INTO _plan_overage
    FROM public.tenants t LEFT JOIN public.billing_plans bp ON bp.id = t.plan_id
   WHERE t.id = _tenant_id;
  _plan_overage := COALESCE(_plan_overage, 'block');
  IF _available < _estimated_tokens AND _plan_overage = 'block' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_funds',
      'available', _available, 'required', _estimated_tokens);
  END IF;
  INSERT INTO public.report_jobs (
    tenant_id, clone_id, kind, status, estimated_tokens,
    idempotency_key, request_payload, reservation_expires_at
  ) VALUES (
    _tenant_id, _clone_id, _kind, 'reserved', _estimated_tokens,
    _idempotency_key, _request_payload, now() + make_interval(secs => _ttl_seconds)
  ) RETURNING id INTO _job_id;
  INSERT INTO public.token_ledger (tenant_id, kind, tokens, source, source_ref, report_job_id, reason)
  VALUES (_tenant_id, 'reserve', _estimated_tokens, 'report', _kind, _job_id, 'reservation');
  SELECT available INTO _available FROM public.token_balances WHERE tenant_id = _tenant_id;
  RETURN jsonb_build_object('ok', true, 'job_id', _job_id,
    'reserved_tokens', _estimated_tokens, 'available_after', COALESCE(_available, 0));
END;
$$;

CREATE TABLE IF NOT EXISTS public.billing_handoffs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clone_id        uuid REFERENCES public.clones(id) ON DELETE CASCADE,
  tenant_id       uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  origin_user_id  text NOT NULL,
  origin_username text,
  origin_source   text NOT NULL,
  intent          text,
  return_url      text,
  expires_at      timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  consumed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_handoffs_expiry_idx ON public.billing_handoffs(expires_at);
ALTER TABLE public.billing_handoffs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_handoffs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.billing_handoffs TO service_role;

CREATE TABLE IF NOT EXISTS public.purchases (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_checkout_session_id  text UNIQUE,
  stripe_payment_intent_id    text,
  stripe_subscription_id      text,
  mode                        text NOT NULL,
  item_id                     uuid,
  item_slug                   text,
  quantity                    integer NOT NULL DEFAULT 1,
  clone_id                    uuid REFERENCES public.clones(id) ON DELETE SET NULL,
  tenant_id                   uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  handoff_id                  uuid REFERENCES public.billing_handoffs(id) ON DELETE SET NULL,
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
DROP TRIGGER IF EXISTS purchases_updated_at ON public.purchases;
CREATE TRIGGER purchases_updated_at
  BEFORE UPDATE ON public.purchases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Operators read purchases" ON public.purchases;
CREATE POLICY "Operators read purchases" ON public.purchases
  FOR SELECT TO authenticated USING (public.is_operator(auth.uid()));
GRANT SELECT ON public.purchases TO authenticated;
GRANT ALL    ON public.purchases TO service_role;

DROP FUNCTION IF EXISTS public.apply_topup(UUID, UUID, TEXT);
CREATE OR REPLACE FUNCTION public.apply_topup(
  _tenant_id UUID, _pack_id UUID, _source_ref TEXT DEFAULT NULL,
  _metadata JSONB DEFAULT '{}'::jsonb
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _pack public.topup_packs%ROWTYPE; _expires TIMESTAMPTZ;
BEGIN
  SELECT * INTO _pack FROM public.topup_packs WHERE id = _pack_id AND is_active = true;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'pack_not_found'); END IF;
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

ALTER TYPE public.notification_kind ADD VALUE IF NOT EXISTS 'purchase_completed';

CREATE OR REPLACE FUNCTION public.cleanup_billing_attribution()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _handoffs INTEGER; _abandoned INTEGER;
BEGIN
  DELETE FROM public.billing_handoffs h
   WHERE h.consumed_at IS NULL
     AND h.expires_at < now() - interval '24 hours'
     AND NOT EXISTS (SELECT 1 FROM public.purchases p WHERE p.handoff_id = h.id);
  GET DIAGNOSTICS _handoffs = ROW_COUNT;
  UPDATE public.purchases SET status = 'abandoned'
   WHERE status = 'initiated' AND created_at < now() - interval '24 hours';
  GET DIAGNOSTICS _abandoned = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'handoffs_deleted', _handoffs, 'purchases_abandoned', _abandoned);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.cleanup_billing_attribution() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.cleanup_billing_attribution() TO service_role;

ALTER TABLE public.clone_backends
  ADD COLUMN IF NOT EXISTS source_repo text,
  ADD COLUMN IF NOT EXISTS source_ref text,
  ADD COLUMN IF NOT EXISTS source_sha text,
  ADD COLUMN IF NOT EXISTS migrations_applied jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS edge_functions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS secret_shells jsonb NOT NULL DEFAULT '[]'::jsonb;

DROP VIEW IF EXISTS public.clone_backends_safe;
CREATE VIEW public.clone_backends_safe
WITH (security_invoker = true) AS
SELECT id, clone_id, supabase_project_ref, supabase_url, region, admin_email,
       migration_version, status, error_message, status_detail,
       source_repo, source_ref, source_sha,
       migrations_applied, edge_functions, secret_shells,
       created_at, updated_at
FROM public.clone_backends;
GRANT SELECT ON public.clone_backends_safe TO authenticated;

ALTER TABLE public.clones  ADD COLUMN IF NOT EXISTS billing_user_id text;
ALTER TABLE public.clones  ADD COLUMN IF NOT EXISTS billing_stripe_customer_id text;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS billing_user_id text;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS billing_stripe_customer_id text;
CREATE UNIQUE INDEX IF NOT EXISTS clones_billing_user_id_uidx
  ON public.clones (billing_user_id)  WHERE billing_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tenants_billing_user_id_uidx
  ON public.tenants (billing_user_id) WHERE billing_user_id IS NOT NULL;
