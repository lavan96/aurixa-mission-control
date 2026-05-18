
-- ─── API keys: rotation + first-use tracking ─────────────────────────────────
ALTER TABLE public.clone_api_keys
  ADD COLUMN IF NOT EXISTS first_used_at timestamptz,
  ADD COLUMN IF NOT EXISTS rotated_from uuid REFERENCES public.clone_api_keys(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rotated_to uuid REFERENCES public.clone_api_keys(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revoke_at timestamptz;

-- ─── Outbound webhooks (Mission Control → Prime) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.token_webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clone_id uuid,
  url text NOT NULL,
  secret text NOT NULL,
  events text[] NOT NULL DEFAULT ARRAY['tokens.balance.updated','tokens.key.revoked','tokens.alert'],
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.token_webhook_endpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins write webhook endpoints" ON public.token_webhook_endpoints
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Operators read webhook endpoints" ON public.token_webhook_endpoints
  FOR SELECT TO authenticated USING (is_operator(auth.uid()));

CREATE TABLE IF NOT EXISTS public.token_webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id uuid NOT NULL REFERENCES public.token_webhook_endpoints(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  response_code integer,
  response_body text,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliv_pending
  ON public.token_webhook_deliveries(next_attempt_at) WHERE status = 'pending';
ALTER TABLE public.token_webhook_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators read webhook deliveries" ON public.token_webhook_deliveries
  FOR SELECT TO authenticated USING (is_operator(auth.uid()));

-- ─── Rate limiting counters ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.token_api_rate_limits (
  key_id uuid NOT NULL REFERENCES public.clone_api_keys(id) ON DELETE CASCADE,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, window_start)
);
ALTER TABLE public.token_api_rate_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators read rate limits" ON public.token_api_rate_limits
  FOR SELECT TO authenticated USING (is_operator(auth.uid()));

CREATE OR REPLACE FUNCTION public.check_api_rate_limit(_key_id uuid, _limit integer DEFAULT 60)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _window timestamptz := date_trunc('minute', now());
  _count integer;
BEGIN
  INSERT INTO public.token_api_rate_limits (key_id, window_start, count)
  VALUES (_key_id, _window, 1)
  ON CONFLICT (key_id, window_start)
  DO UPDATE SET count = public.token_api_rate_limits.count + 1
  RETURNING count INTO _count;

  -- Best-effort cleanup of old windows (older than 10 min)
  DELETE FROM public.token_api_rate_limits
   WHERE window_start < now() - interval '10 minutes';

  IF _count > _limit THEN
    RETURN jsonb_build_object('ok', false, 'count', _count, 'limit', _limit, 'retry_after_seconds',
      EXTRACT(epoch FROM (_window + interval '1 minute' - now()))::int);
  END IF;
  RETURN jsonb_build_object('ok', true, 'count', _count, 'limit', _limit);
END;
$$;

-- ─── Expire stale reservations ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.expire_stale_reservations()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _count int := 0; _job public.report_jobs%ROWTYPE;
BEGIN
  FOR _job IN
    SELECT * FROM public.report_jobs
     WHERE status = 'reserved'
       AND reservation_expires_at IS NOT NULL
       AND reservation_expires_at < now()
     LIMIT 500
  LOOP
    PERFORM public.cancel_token_reservation(_job.id, 'reservation_expired');
    _count := _count + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'expired', _count);
END;
$$;

-- ─── Tenant usage summary (burn rate, projection) ────────────────────────────
CREATE OR REPLACE FUNCTION public.tenant_usage_summary(_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _bal RECORD;
  _plan RECORD;
  _period_spent int;
  _last_7d int;
  _last_24h int;
  _cancels_24h int;
  _completed_24h int;
  _avg_per_day numeric;
  _days_until_empty numeric;
  _allowance_used_pct numeric;
BEGIN
  SELECT available, reserved, lifetime_granted, lifetime_spent INTO _bal
    FROM public.token_balances WHERE tenant_id = _tenant_id;

  SELECT bp.monthly_allowance, t.current_period_start, t.current_period_end, t.status
    INTO _plan
    FROM public.tenants t
    LEFT JOIN public.billing_plans bp ON bp.id = t.plan_id
   WHERE t.id = _tenant_id;

  SELECT COALESCE(SUM(charged_tokens),0) INTO _period_spent
    FROM public.report_jobs
   WHERE tenant_id = _tenant_id
     AND status IN ('completed','refunded')
     AND completed_at >= COALESCE(_plan.current_period_start, now() - interval '30 days');

  SELECT COALESCE(SUM(charged_tokens),0) INTO _last_7d
    FROM public.report_jobs
   WHERE tenant_id = _tenant_id AND status = 'completed'
     AND completed_at >= now() - interval '7 days';

  SELECT COALESCE(SUM(charged_tokens),0) INTO _last_24h
    FROM public.report_jobs
   WHERE tenant_id = _tenant_id AND status = 'completed'
     AND completed_at >= now() - interval '24 hours';

  SELECT
    COUNT(*) FILTER (WHERE status IN ('canceled','failed')),
    COUNT(*) FILTER (WHERE status = 'completed')
  INTO _cancels_24h, _completed_24h
    FROM public.report_jobs
   WHERE tenant_id = _tenant_id
     AND started_at >= now() - interval '24 hours';

  _avg_per_day := _last_7d / 7.0;
  IF _avg_per_day > 0 AND COALESCE(_bal.available, 0) > 0 THEN
    _days_until_empty := _bal.available / _avg_per_day;
  ELSE
    _days_until_empty := NULL;
  END IF;

  IF COALESCE(_plan.monthly_allowance, 0) > 0 THEN
    _allowance_used_pct := LEAST(100, (_period_spent::numeric / _plan.monthly_allowance) * 100);
  ELSE
    _allowance_used_pct := NULL;
  END IF;

  RETURN jsonb_build_object(
    'available', COALESCE(_bal.available, 0),
    'reserved', COALESCE(_bal.reserved, 0),
    'lifetime_granted', COALESCE(_bal.lifetime_granted, 0),
    'lifetime_spent', COALESCE(_bal.lifetime_spent, 0),
    'period_spent', _period_spent,
    'period_end', _plan.current_period_end,
    'monthly_allowance', _plan.monthly_allowance,
    'allowance_used_pct', _allowance_used_pct,
    'last_7d_spent', _last_7d,
    'last_24h_spent', _last_24h,
    'avg_per_day_7d', _avg_per_day,
    'days_until_empty', _days_until_empty,
    'projected_exhaustion', CASE WHEN _days_until_empty IS NOT NULL
        THEN (now() + make_interval(secs => (_days_until_empty * 86400)::int)) ELSE NULL END,
    'cancels_24h', _cancels_24h,
    'completed_24h', _completed_24h,
    'cancel_rate_24h', CASE WHEN (_cancels_24h + _completed_24h) > 0
        THEN (_cancels_24h::numeric / (_cancels_24h + _completed_24h)) ELSE 0 END
  );
END;
$$;

-- ─── Key rotation ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.schedule_key_revoke(_key_id uuid, _at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.clone_api_keys SET revoke_at = _at WHERE id = _key_id AND revoked_at IS NULL;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_scheduled_keys()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _count int;
BEGIN
  WITH r AS (
    UPDATE public.clone_api_keys
       SET revoked_at = now()
     WHERE revoke_at IS NOT NULL AND revoke_at <= now() AND revoked_at IS NULL
     RETURNING id
  )
  SELECT COUNT(*) INTO _count FROM r;
  RETURN jsonb_build_object('ok', true, 'revoked', _count);
END;
$$;
