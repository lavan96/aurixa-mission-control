-- ============================================================
-- Migration 1: Seed prime tenant billing_user_id
-- ============================================================
UPDATE public.tenants
   SET billing_user_id = 'npc-prime'
 WHERE external_ref = 'prime:dduzbchuswwbefdunfct'
   AND billing_user_id IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.tenants t2 WHERE t2.billing_user_id = 'npc-prime'
   );

DO $$
DECLARE r RECORD;
BEGIN
  SELECT id, billing_user_id INTO r
    FROM public.tenants WHERE external_ref = 'prime:dduzbchuswwbefdunfct';
  IF NOT FOUND THEN
    RAISE WARNING 'Prime tenant not found — auto-provisioned on first prime call.';
  ELSIF r.billing_user_id IS NULL THEN
    RAISE WARNING 'Prime tenant still has NULL billing_user_id — is npc-prime taken?';
  END IF;
END $$;

-- ============================================================
-- Migration 2: Prime billing exemption + reservation sweep + repair
-- ============================================================
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS billing_exempt boolean NOT NULL DEFAULT false;

UPDATE public.tenants
SET billing_exempt = true,
    plan_id = NULL
WHERE external_ref LIKE 'prime:%';

UPDATE public.token_ledger
SET metadata = COALESCE(metadata, '{}'::jsonb)
      || jsonb_build_object(
           'unit_corrected', true,
           'original_tokens', tokens,
           'corrected_at', now()
         ),
    tokens = (SIGN(tokens) * CEIL(ABS(tokens) / 1000.0))::int
WHERE kind IN ('reserve', 'release')
  AND ABS(tokens) >= 1000
  AND created_at < TIMESTAMPTZ '2026-07-14 16:17:00+00'
  AND (metadata ->> 'unit_corrected') IS NULL;

UPDATE public.report_jobs
SET estimated_tokens = CEIL(estimated_tokens / 1000.0)::int
WHERE estimated_tokens >= 1000
  AND created_at < TIMESTAMPTZ '2026-07-14 16:17:00+00';

DO $$
DECLARE _j UUID;
BEGIN
  FOR _j IN
    SELECT id FROM public.report_jobs
    WHERE status = 'reserved'
      AND reservation_expires_at IS NOT NULL
      AND reservation_expires_at < now()
  LOOP
    PERFORM public.cancel_token_reservation(_j, 'stale_reservation_sweep');
  END LOOP;
END;
$$;

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
  _exempt BOOLEAN;
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
  SELECT bp.overage_policy, t.billing_exempt INTO _plan_overage, _exempt
    FROM public.tenants t LEFT JOIN public.billing_plans bp ON bp.id = t.plan_id
   WHERE t.id = _tenant_id;
  IF NOT COALESCE(_exempt, false) THEN
    _plan_overage := COALESCE(_plan_overage, 'block');
    IF _available < _estimated_tokens AND _plan_overage = 'block' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'insufficient_funds',
        'available', _available, 'required', _estimated_tokens);
    END IF;
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

DO $$
DECLARE _t UUID;
BEGIN
  FOR _t IN SELECT DISTINCT tenant_id FROM public.token_ledger LOOP
    PERFORM public.recompute_token_balance(_t);
  END LOOP;
END;
$$;