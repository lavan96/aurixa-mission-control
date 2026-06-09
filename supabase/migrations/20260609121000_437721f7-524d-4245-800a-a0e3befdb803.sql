-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 3 — correctness hardening for the token ledger.
--
-- 1) reserve_tokens: the balance check and the reserve insert were not atomic, so
--    two concurrent reservations for the same tenant could both read the same
--    available balance and both succeed, over-reserving past a 'block' overage
--    policy. Take a per-tenant transaction-scoped advisory lock so the
--    check-then-insert is serialized per tenant.
--
-- 2) apply_topup: it inserted a 'topup' ledger entry on every call, so a retried
--    Stripe webhook delivery (same checkout session) would grant tokens twice.
--    Make it idempotent on source_ref.
--
-- Both functions are re-created in full (only the noted lines are new).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reserve_tokens(
  _tenant_id UUID,
  _clone_id UUID,
  _kind TEXT,
  _estimated_tokens INTEGER,
  _idempotency_key TEXT,
  _ttl_seconds INTEGER DEFAULT 600,
  _request_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _existing public.report_jobs%ROWTYPE;
  _job_id UUID;
  _available INTEGER;
  _plan_overage public.overage_policy;
BEGIN
  IF _estimated_tokens IS NULL OR _estimated_tokens < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_estimate');
  END IF;

  -- Serialize concurrent reservations for the same tenant: the balance check and
  -- the reserve insert below must be atomic, otherwise two concurrent calls can
  -- both pass the check and over-reserve past a 'block' overage policy. The lock
  -- is released automatically at transaction end.
  PERFORM pg_advisory_xact_lock(hashtextextended(_tenant_id::text, 0));

  -- Idempotency: if we've seen this (clone_id, idempotency_key) before,
  -- return the existing job rather than charging twice.
  SELECT * INTO _existing FROM public.report_jobs
   WHERE clone_id = _clone_id AND idempotency_key = _idempotency_key
   LIMIT 1;
  IF FOUND THEN
    SELECT available INTO _available FROM public.token_balances WHERE tenant_id = _existing.tenant_id;
    RETURN jsonb_build_object(
      'ok', true,
      'job_id', _existing.id,
      'reserved_tokens', _existing.estimated_tokens,
      'available_after', COALESCE(_available, 0),
      'idempotent', true,
      'status', _existing.status
    );
  END IF;

  -- Check balance
  PERFORM public.recompute_token_balance(_tenant_id);
  SELECT available INTO _available FROM public.token_balances WHERE tenant_id = _tenant_id;
  _available := COALESCE(_available, 0);

  SELECT bp.overage_policy INTO _plan_overage
    FROM public.tenants t LEFT JOIN public.billing_plans bp ON bp.id = t.plan_id
   WHERE t.id = _tenant_id;
  _plan_overage := COALESCE(_plan_overage, 'block');

  IF _available < _estimated_tokens AND _plan_overage = 'block' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'insufficient_funds',
      'available', _available,
      'required', _estimated_tokens
    );
  END IF;

  INSERT INTO public.report_jobs (
    tenant_id, clone_id, kind, status, estimated_tokens,
    idempotency_key, request_payload, reservation_expires_at
  ) VALUES (
    _tenant_id, _clone_id, _kind, 'reserved', _estimated_tokens,
    _idempotency_key, _request_payload, now() + make_interval(secs => _ttl_seconds)
  )
  RETURNING id INTO _job_id;

  INSERT INTO public.token_ledger (
    tenant_id, kind, tokens, source, source_ref, report_job_id, reason
  ) VALUES (
    _tenant_id, 'reserve', _estimated_tokens, 'report', _kind, _job_id, 'reservation'
  );

  SELECT available INTO _available FROM public.token_balances WHERE tenant_id = _tenant_id;
  RETURN jsonb_build_object(
    'ok', true, 'job_id', _job_id,
    'reserved_tokens', _estimated_tokens,
    'available_after', COALESCE(_available, 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_topup(
  _tenant_id UUID, _pack_id UUID, _source_ref TEXT DEFAULT NULL
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
  INSERT INTO public.token_ledger (tenant_id, kind, tokens, source, source_ref, reason, expires_at, created_by)
  VALUES (_tenant_id, 'topup', _pack.tokens, 'topup', COALESCE(_source_ref, _pack.slug), 'topup_' || _pack.slug, _expires, auth.uid());
  RETURN jsonb_build_object('ok', true, 'tokens', _pack.tokens, 'expires_at', _expires);
END;
$$;
