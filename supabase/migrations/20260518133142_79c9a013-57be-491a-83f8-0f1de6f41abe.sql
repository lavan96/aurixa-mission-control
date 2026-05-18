
-- ─────────────────────────────────────────────────────────────────────────────
-- Token metering: plans, packs, tenants, ledger, balances, report jobs, rates,
-- clone API keys. Source of truth for entitlements consumed by every clone.
-- ─────────────────────────────────────────────────────────────────────────────

-- Enums
CREATE TYPE public.overage_policy AS ENUM ('block', 'topup_only', 'pay_as_you_go');
CREATE TYPE public.tenant_status AS ENUM ('active', 'past_due', 'canceled');
CREATE TYPE public.ledger_kind AS ENUM ('grant', 'topup', 'debit', 'refund', 'adjustment', 'expiry', 'reserve', 'release');
CREATE TYPE public.ledger_source AS ENUM ('subscription', 'topup', 'manual', 'system', 'report');
CREATE TYPE public.report_job_status AS ENUM ('pending', 'reserved', 'completed', 'failed', 'refunded', 'canceled');

-- ─── billing_plans ───────────────────────────────────────────────────────────
CREATE TABLE public.billing_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  monthly_allowance INTEGER NOT NULL DEFAULT 0 CHECK (monthly_allowance >= 0),
  rollover_cap INTEGER NOT NULL DEFAULT 0 CHECK (rollover_cap >= 0),
  overage_policy public.overage_policy NOT NULL DEFAULT 'block',
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  is_active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.billing_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators read billing_plans" ON public.billing_plans
  FOR SELECT TO authenticated USING (public.is_operator(auth.uid()));
CREATE POLICY "Admins write billing_plans" ON public.billing_plans
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ─── topup_packs ─────────────────────────────────────────────────────────────
CREATE TABLE public.topup_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  tokens INTEGER NOT NULL CHECK (tokens > 0),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  expires_after_days INTEGER CHECK (expires_after_days IS NULL OR expires_after_days > 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.topup_packs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators read topup_packs" ON public.topup_packs
  FOR SELECT TO authenticated USING (public.is_operator(auth.uid()));
CREATE POLICY "Admins write topup_packs" ON public.topup_packs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ─── tenants ─────────────────────────────────────────────────────────────────
CREATE TABLE public.tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clone_id UUID REFERENCES public.clones(id) ON DELETE CASCADE,
  external_ref TEXT NOT NULL,
  display_name TEXT,
  plan_id UUID REFERENCES public.billing_plans(id) ON DELETE SET NULL,
  plan_started_at TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  status public.tenant_status NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clone_id, external_ref)
);
CREATE INDEX idx_tenants_clone ON public.tenants(clone_id);
CREATE INDEX idx_tenants_status ON public.tenants(status);
CREATE INDEX idx_tenants_period_end ON public.tenants(current_period_end);
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators read tenants" ON public.tenants
  FOR SELECT TO authenticated USING (public.is_operator(auth.uid()));
CREATE POLICY "Operators write tenants" ON public.tenants
  FOR ALL TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));

-- ─── token_rates ─────────────────────────────────────────────────────────────
CREATE TABLE public.token_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL,
  base_cost INTEGER NOT NULL DEFAULT 0 CHECK (base_cost >= 0),
  per_unit JSONB NOT NULL DEFAULT '{}'::jsonb,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_token_rates_kind_effective ON public.token_rates(kind, effective_from DESC);
ALTER TABLE public.token_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators read token_rates" ON public.token_rates
  FOR SELECT TO authenticated USING (public.is_operator(auth.uid()));
CREATE POLICY "Admins write token_rates" ON public.token_rates
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ─── report_jobs ─────────────────────────────────────────────────────────────
CREATE TABLE public.report_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  clone_id UUID REFERENCES public.clones(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  status public.report_job_status NOT NULL DEFAULT 'pending',
  estimated_tokens INTEGER NOT NULL DEFAULT 0 CHECK (estimated_tokens >= 0),
  charged_tokens INTEGER NOT NULL DEFAULT 0 CHECK (charged_tokens >= 0),
  idempotency_key TEXT NOT NULL,
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  reservation_expires_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clone_id, idempotency_key)
);
CREATE INDEX idx_report_jobs_tenant ON public.report_jobs(tenant_id, started_at DESC);
CREATE INDEX idx_report_jobs_status ON public.report_jobs(status);
CREATE INDEX idx_report_jobs_reservation_expiry ON public.report_jobs(reservation_expires_at)
  WHERE status = 'reserved';
ALTER TABLE public.report_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators read report_jobs" ON public.report_jobs
  FOR SELECT TO authenticated USING (public.is_operator(auth.uid()));
CREATE POLICY "Operators write report_jobs" ON public.report_jobs
  FOR ALL TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));

-- ─── token_ledger (append-only) ──────────────────────────────────────────────
CREATE TABLE public.token_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind public.ledger_kind NOT NULL,
  tokens INTEGER NOT NULL,
  source public.ledger_source NOT NULL,
  source_ref TEXT,
  report_job_id UUID REFERENCES public.report_jobs(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ,
  reason TEXT,
  created_by UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ledger_tenant_created ON public.token_ledger(tenant_id, created_at DESC);
CREATE INDEX idx_ledger_expires ON public.token_ledger(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_ledger_job ON public.token_ledger(report_job_id) WHERE report_job_id IS NOT NULL;
ALTER TABLE public.token_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators read token_ledger" ON public.token_ledger
  FOR SELECT TO authenticated USING (public.is_operator(auth.uid()));
-- No direct INSERT/UPDATE/DELETE policies — only via SECURITY DEFINER RPCs.

-- ─── token_balances (materialized cache) ─────────────────────────────────────
CREATE TABLE public.token_balances (
  tenant_id UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  available INTEGER NOT NULL DEFAULT 0,
  reserved INTEGER NOT NULL DEFAULT 0,
  lifetime_granted INTEGER NOT NULL DEFAULT 0,
  lifetime_spent INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.token_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators read token_balances" ON public.token_balances
  FOR SELECT TO authenticated USING (public.is_operator(auth.uid()));

-- ─── clone_api_keys ──────────────────────────────────────────────────────────
CREATE TABLE public.clone_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clone_id UUID NOT NULL REFERENCES public.clones(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scopes TEXT[] NOT NULL DEFAULT ARRAY['tokens:meter']::text[],
  created_by UUID,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_clone_api_keys_clone ON public.clone_api_keys(clone_id);
ALTER TABLE public.clone_api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators read clone_api_keys" ON public.clone_api_keys
  FOR SELECT TO authenticated USING (public.is_operator(auth.uid()));
CREATE POLICY "Admins write clone_api_keys" ON public.clone_api_keys
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ─── updated_at triggers ─────────────────────────────────────────────────────
CREATE TRIGGER trg_billing_plans_updated_at BEFORE UPDATE ON public.billing_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_topup_packs_updated_at BEFORE UPDATE ON public.topup_packs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_tenants_updated_at BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_token_rates_updated_at BEFORE UPDATE ON public.token_rates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_report_jobs_updated_at BEFORE UPDATE ON public.report_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─── balance recomputation ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recompute_token_balance(_tenant_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _avail INTEGER;
  _reserved INTEGER;
  _granted INTEGER;
  _spent INTEGER;
BEGIN
  -- available = sum of all non-expired credits/debits except reserve/release pairs
  SELECT
    COALESCE(SUM(CASE
      WHEN kind IN ('grant', 'topup', 'refund', 'adjustment') THEN tokens
      WHEN kind IN ('debit', 'expiry') THEN -ABS(tokens)
      ELSE 0
    END), 0),
    COALESCE(SUM(CASE
      WHEN kind = 'reserve' THEN ABS(tokens)
      WHEN kind = 'release' THEN -ABS(tokens)
      WHEN kind = 'debit' AND report_job_id IS NOT NULL THEN -ABS(tokens)
      ELSE 0
    END), 0),
    COALESCE(SUM(CASE WHEN kind IN ('grant', 'topup') THEN tokens ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN kind = 'debit' THEN ABS(tokens) ELSE 0 END), 0)
  INTO _avail, _reserved, _granted, _spent
  FROM public.token_ledger
  WHERE tenant_id = _tenant_id
    AND (expires_at IS NULL OR expires_at > now());

  -- Reserved is the running balance of reserves not yet released or debited
  SELECT GREATEST(0, _reserved) INTO _reserved;

  INSERT INTO public.token_balances (tenant_id, available, reserved, lifetime_granted, lifetime_spent, updated_at)
  VALUES (_tenant_id, GREATEST(0, _avail - _reserved), _reserved, _granted, _spent, now())
  ON CONFLICT (tenant_id) DO UPDATE
    SET available = EXCLUDED.available,
        reserved = EXCLUDED.reserved,
        lifetime_granted = EXCLUDED.lifetime_granted,
        lifetime_spent = EXCLUDED.lifetime_spent,
        updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_ledger_recompute_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.recompute_token_balance(NEW.tenant_id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ledger_after_insert
AFTER INSERT ON public.token_ledger
FOR EACH ROW EXECUTE FUNCTION public.tg_ledger_recompute_balance();

-- ─── SECURITY DEFINER RPCs (the only path to mutate the ledger) ──────────────

-- Reserve tokens for a report job. Creates the job + a 'reserve' ledger entry.
-- Returns json: { ok, job_id, reserved_tokens, available_after, error? }
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

-- Commit a reserved job. Releases the reserve and debits the actual amount.
CREATE OR REPLACE FUNCTION public.commit_tokens(
  _job_id UUID,
  _actual_tokens INTEGER,
  _result_meta JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _job public.report_jobs%ROWTYPE;
  _available INTEGER;
BEGIN
  SELECT * INTO _job FROM public.report_jobs WHERE id = _job_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'job_not_found');
  END IF;
  IF _job.status = 'completed' THEN
    SELECT available INTO _available FROM public.token_balances WHERE tenant_id = _job.tenant_id;
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'charged_tokens', _job.charged_tokens, 'available_after', COALESCE(_available,0));
  END IF;
  IF _job.status <> 'reserved' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'job_not_reservable', 'status', _job.status);
  END IF;
  IF _actual_tokens IS NULL OR _actual_tokens < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_actual');
  END IF;

  -- Release reservation
  INSERT INTO public.token_ledger (tenant_id, kind, tokens, source, source_ref, report_job_id, reason)
  VALUES (_job.tenant_id, 'release', _job.estimated_tokens, 'report', _job.kind, _job.id, 'commit_release');

  -- Debit actual
  IF _actual_tokens > 0 THEN
    INSERT INTO public.token_ledger (tenant_id, kind, tokens, source, source_ref, report_job_id, reason)
    VALUES (_job.tenant_id, 'debit', _actual_tokens, 'report', _job.kind, _job.id, 'commit_debit');
  END IF;

  UPDATE public.report_jobs
     SET status = 'completed',
         charged_tokens = _actual_tokens,
         result_meta = _result_meta,
         completed_at = now(),
         reservation_expires_at = NULL
   WHERE id = _job_id;

  SELECT available INTO _available FROM public.token_balances WHERE tenant_id = _job.tenant_id;
  RETURN jsonb_build_object('ok', true, 'charged_tokens', _actual_tokens, 'available_after', COALESCE(_available, 0));
END;
$$;

-- Cancel a reserved job (release reservation, no debit).
CREATE OR REPLACE FUNCTION public.cancel_token_reservation(_job_id UUID, _reason TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _job public.report_jobs%ROWTYPE;
BEGIN
  SELECT * INTO _job FROM public.report_jobs WHERE id = _job_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'job_not_found');
  END IF;
  IF _job.status <> 'reserved' THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'status', _job.status);
  END IF;

  INSERT INTO public.token_ledger (tenant_id, kind, tokens, source, source_ref, report_job_id, reason)
  VALUES (_job.tenant_id, 'release', _job.estimated_tokens, 'report', _job.kind, _job.id, COALESCE(_reason, 'canceled'));

  UPDATE public.report_jobs
     SET status = 'canceled', error = _reason, reservation_expires_at = NULL, completed_at = now()
   WHERE id = _job_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Refund a completed job.
CREATE OR REPLACE FUNCTION public.refund_job(_job_id UUID, _reason TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _job public.report_jobs%ROWTYPE;
BEGIN
  SELECT * INTO _job FROM public.report_jobs WHERE id = _job_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'job_not_found'); END IF;
  IF _job.status <> 'completed' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_refundable', 'status', _job.status);
  END IF;
  IF _job.charged_tokens > 0 THEN
    INSERT INTO public.token_ledger (tenant_id, kind, tokens, source, source_ref, report_job_id, reason, created_by)
    VALUES (_job.tenant_id, 'refund', _job.charged_tokens, 'manual', _job.kind, _job.id, COALESCE(_reason, 'manual_refund'), auth.uid());
  END IF;
  UPDATE public.report_jobs SET status = 'refunded', completed_at = now() WHERE id = _job_id;
  RETURN jsonb_build_object('ok', true, 'refunded_tokens', _job.charged_tokens);
END;
$$;

-- Grant tokens manually (operator action).
CREATE OR REPLACE FUNCTION public.grant_tokens(
  _tenant_id UUID, _tokens INTEGER, _reason TEXT, _expires_at TIMESTAMPTZ DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _tokens IS NULL OR _tokens <= 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount'); END IF;
  INSERT INTO public.token_ledger (tenant_id, kind, tokens, source, reason, expires_at, created_by)
  VALUES (_tenant_id, 'grant', _tokens, 'manual', _reason, _expires_at, auth.uid());
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Apply a top-up pack to a tenant.
CREATE OR REPLACE FUNCTION public.apply_topup(
  _tenant_id UUID, _pack_id UUID, _source_ref TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _pack public.topup_packs%ROWTYPE; _expires TIMESTAMPTZ;
BEGIN
  SELECT * INTO _pack FROM public.topup_packs WHERE id = _pack_id AND is_active = true;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'pack_not_found'); END IF;
  IF _pack.expires_after_days IS NOT NULL THEN
    _expires := now() + make_interval(days => _pack.expires_after_days);
  END IF;
  INSERT INTO public.token_ledger (tenant_id, kind, tokens, source, source_ref, reason, expires_at, created_by)
  VALUES (_tenant_id, 'topup', _pack.tokens, 'topup', COALESCE(_source_ref, _pack.slug), 'topup_' || _pack.slug, _expires, auth.uid());
  RETURN jsonb_build_object('ok', true, 'tokens', _pack.tokens, 'expires_at', _expires);
END;
$$;

-- Seed a default Free plan + starter packs so the system is usable immediately.
INSERT INTO public.billing_plans (slug, name, monthly_allowance, rollover_cap, overage_policy, price_cents)
VALUES
  ('free', 'Free', 100, 0, 'block', 0),
  ('starter', 'Starter', 1000, 0, 'topup_only', 1900),
  ('pro', 'Pro', 10000, 2000, 'topup_only', 9900)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.topup_packs (slug, name, tokens, price_cents, expires_after_days)
VALUES
  ('topup-500', '500 Token Pack', 500, 500, NULL),
  ('topup-2k', '2,000 Token Pack', 2000, 1800, NULL),
  ('topup-10k', '10,000 Token Pack', 10000, 8000, NULL)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.token_rates (kind, base_cost, per_unit, notes)
VALUES
  ('default', 10, '{"pages":2,"ai_input_tokens":0.001,"ai_output_tokens":0.002}'::jsonb,
   'Default report rate; clones can override per kind')
ON CONFLICT DO NOTHING;
