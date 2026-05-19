
-- 1. Notification kinds
ALTER TYPE notification_kind ADD VALUE IF NOT EXISTS 'seat_limit_approaching';
ALTER TYPE notification_kind ADD VALUE IF NOT EXISTS 'seat_limit_reached';
ALTER TYPE notification_kind ADD VALUE IF NOT EXISTS 'seat_plan_changed';

-- 2. seat_plans
CREATE TABLE public.seat_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  seat_limit integer NOT NULL CHECK (seat_limit >= 0),
  device_limit_per_seat integer,
  price_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  overage_policy text NOT NULL DEFAULT 'block',
  is_active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.seat_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators read seat_plans" ON public.seat_plans FOR SELECT TO authenticated USING (is_operator(auth.uid()));
CREATE POLICY "Admins write seat_plans" ON public.seat_plans FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER seat_plans_updated BEFORE UPDATE ON public.seat_plans FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. clone_seat_entitlements
CREATE TABLE public.clone_seat_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clone_id uuid UNIQUE, -- nullable = "prime repo" baseline entitlement
  seat_plan_id uuid NOT NULL REFERENCES public.seat_plans(id),
  seats_used integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX clone_seat_entitlements_prime_unique ON public.clone_seat_entitlements ((clone_id IS NULL)) WHERE clone_id IS NULL;
ALTER TABLE public.clone_seat_entitlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators read clone_seat_entitlements" ON public.clone_seat_entitlements FOR SELECT TO authenticated USING (is_operator(auth.uid()));
CREATE POLICY "Operators write clone_seat_entitlements" ON public.clone_seat_entitlements FOR ALL TO authenticated USING (is_operator(auth.uid())) WITH CHECK (is_operator(auth.uid()));
CREATE TRIGGER clone_seat_entitlements_updated BEFORE UPDATE ON public.clone_seat_entitlements FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. clone_seats
CREATE TABLE public.clone_seats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clone_id uuid,
  external_user_id text NOT NULL,
  email text,
  display_name text,
  status text NOT NULL DEFAULT 'reserved', -- reserved | active | removed
  device_count integer NOT NULL DEFAULT 0,
  idempotency_key text,
  reservation_expires_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz,
  removed_at timestamptz
);
CREATE UNIQUE INDEX clone_seats_clone_external_unique ON public.clone_seats (clone_id, external_user_id) WHERE status <> 'removed';
CREATE UNIQUE INDEX clone_seats_idem_unique ON public.clone_seats (clone_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX clone_seats_status_idx ON public.clone_seats (clone_id, status);
ALTER TABLE public.clone_seats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators read clone_seats" ON public.clone_seats FOR SELECT TO authenticated USING (is_operator(auth.uid()));
CREATE POLICY "Operators write clone_seats" ON public.clone_seats FOR ALL TO authenticated USING (is_operator(auth.uid())) WITH CHECK (is_operator(auth.uid()));
CREATE TRIGGER clone_seats_updated BEFORE UPDATE ON public.clone_seats FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. seat_audit
CREATE TABLE public.seat_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clone_id uuid,
  action text NOT NULL, -- reserve | commit | release | cap_hit | plan_change | manual_add | manual_remove
  external_user_id text,
  seat_id uuid,
  actor_user_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX seat_audit_clone_idx ON public.seat_audit (clone_id, created_at DESC);
ALTER TABLE public.seat_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators read seat_audit" ON public.seat_audit FOR SELECT TO authenticated USING (is_operator(auth.uid()));
CREATE POLICY "Operators insert seat_audit" ON public.seat_audit FOR INSERT TO authenticated WITH CHECK (is_operator(auth.uid()));

-- 6. Recompute seats_used helper
CREATE OR REPLACE FUNCTION public.recompute_seats_used(_clone_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _used int;
BEGIN
  SELECT COUNT(*) INTO _used
    FROM public.clone_seats
   WHERE (clone_id IS NOT DISTINCT FROM _clone_id)
     AND status IN ('reserved','active');
  UPDATE public.clone_seat_entitlements
     SET seats_used = _used, updated_at = now()
   WHERE clone_id IS NOT DISTINCT FROM _clone_id;
  RETURN _used;
END;
$$;

-- 7. reserve_seat
CREATE OR REPLACE FUNCTION public.reserve_seat(
  _clone_id uuid,
  _external_user_id text,
  _email text,
  _display_name text,
  _idempotency_key text,
  _ttl_seconds integer DEFAULT 600
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _ent public.clone_seat_entitlements%ROWTYPE;
  _plan public.seat_plans%ROWTYPE;
  _existing public.clone_seats%ROWTYPE;
  _used int;
  _seat_id uuid;
BEGIN
  -- Idempotency
  IF _idempotency_key IS NOT NULL THEN
    SELECT * INTO _existing FROM public.clone_seats
     WHERE clone_id IS NOT DISTINCT FROM _clone_id
       AND idempotency_key = _idempotency_key LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'idempotent', true, 'seat_id', _existing.id, 'status', _existing.status);
    END IF;
  END IF;

  -- Existing active/reserved for same external_user_id?
  SELECT * INTO _existing FROM public.clone_seats
   WHERE clone_id IS NOT DISTINCT FROM _clone_id
     AND external_user_id = _external_user_id
     AND status <> 'removed' LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'seat_id', _existing.id, 'status', _existing.status);
  END IF;

  SELECT * INTO _ent FROM public.clone_seat_entitlements
   WHERE clone_id IS NOT DISTINCT FROM _clone_id FOR UPDATE;
  IF NOT FOUND THEN
    -- Auto-assign default plan
    SELECT * INTO _plan FROM public.seat_plans WHERE is_default = true AND is_active = true LIMIT 1;
    IF NOT FOUND THEN
      SELECT * INTO _plan FROM public.seat_plans WHERE is_active = true ORDER BY price_cents ASC LIMIT 1;
    END IF;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'no_plan_available');
    END IF;
    INSERT INTO public.clone_seat_entitlements (clone_id, seat_plan_id, seats_used)
    VALUES (_clone_id, _plan.id, 0) RETURNING * INTO _ent;
  ELSE
    SELECT * INTO _plan FROM public.seat_plans WHERE id = _ent.seat_plan_id;
  END IF;

  SELECT public.recompute_seats_used(_clone_id) INTO _used;

  IF _used >= _plan.seat_limit AND _plan.overage_policy = 'block' THEN
    INSERT INTO public.seat_audit (clone_id, action, external_user_id, metadata)
    VALUES (_clone_id, 'cap_hit', _external_user_id,
      jsonb_build_object('plan', _plan.slug, 'seat_limit', _plan.seat_limit, 'used', _used));
    RETURN jsonb_build_object('ok', false, 'error', 'seat_limit_reached',
      'seat_limit', _plan.seat_limit, 'seats_used', _used, 'plan', _plan.slug);
  END IF;

  INSERT INTO public.clone_seats (clone_id, external_user_id, email, display_name, status, idempotency_key, reservation_expires_at)
  VALUES (_clone_id, _external_user_id, _email, _display_name, 'reserved', _idempotency_key,
          now() + make_interval(secs => _ttl_seconds))
  RETURNING id INTO _seat_id;

  SELECT public.recompute_seats_used(_clone_id) INTO _used;

  INSERT INTO public.seat_audit (clone_id, action, external_user_id, seat_id, metadata)
  VALUES (_clone_id, 'reserve', _external_user_id, _seat_id,
    jsonb_build_object('plan', _plan.slug, 'seats_used', _used, 'seat_limit', _plan.seat_limit));

  RETURN jsonb_build_object('ok', true, 'seat_id', _seat_id, 'status', 'reserved',
    'seat_limit', _plan.seat_limit, 'seats_used', _used,
    'seats_remaining', GREATEST(0, _plan.seat_limit - _used));
END;
$$;

-- 8. commit_seat
CREATE OR REPLACE FUNCTION public.commit_seat(_seat_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _seat public.clone_seats%ROWTYPE;
BEGIN
  SELECT * INTO _seat FROM public.clone_seats WHERE id = _seat_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'seat_not_found'); END IF;
  IF _seat.status = 'active' THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'status', 'active');
  END IF;
  IF _seat.status <> 'reserved' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_reserved', 'status', _seat.status);
  END IF;
  UPDATE public.clone_seats SET status = 'active', committed_at = now(), reservation_expires_at = NULL WHERE id = _seat_id;
  INSERT INTO public.seat_audit (clone_id, action, external_user_id, seat_id)
  VALUES (_seat.clone_id, 'commit', _seat.external_user_id, _seat_id);
  PERFORM public.recompute_seats_used(_seat.clone_id);
  RETURN jsonb_build_object('ok', true, 'status', 'active');
END;
$$;

-- 9. release_seat
CREATE OR REPLACE FUNCTION public.release_seat(_clone_id uuid, _external_user_id text, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _seat public.clone_seats%ROWTYPE; _used int;
BEGIN
  SELECT * INTO _seat FROM public.clone_seats
   WHERE clone_id IS NOT DISTINCT FROM _clone_id
     AND external_user_id = _external_user_id
     AND status <> 'removed' LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true);
  END IF;
  UPDATE public.clone_seats SET status = 'removed', removed_at = now() WHERE id = _seat.id;
  INSERT INTO public.seat_audit (clone_id, action, external_user_id, seat_id, metadata)
  VALUES (_clone_id, 'release', _external_user_id, _seat.id, jsonb_build_object('reason', _reason));
  SELECT public.recompute_seats_used(_clone_id) INTO _used;
  RETURN jsonb_build_object('ok', true, 'seats_used', _used);
END;
$$;

-- 10. expire_stale_seat_reservations (cron-callable)
CREATE OR REPLACE FUNCTION public.expire_stale_seat_reservations()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _count int := 0; _seat public.clone_seats%ROWTYPE;
BEGIN
  FOR _seat IN
    SELECT * FROM public.clone_seats
     WHERE status = 'reserved'
       AND reservation_expires_at IS NOT NULL
       AND reservation_expires_at < now()
     LIMIT 500
  LOOP
    UPDATE public.clone_seats SET status = 'removed', removed_at = now() WHERE id = _seat.id;
    INSERT INTO public.seat_audit (clone_id, action, external_user_id, seat_id, metadata)
    VALUES (_seat.clone_id, 'release', _seat.external_user_id, _seat.id, jsonb_build_object('reason', 'reservation_expired'));
    PERFORM public.recompute_seats_used(_seat.clone_id);
    _count := _count + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'expired', _count);
END;
$$;

-- 11. Seed mock plans
INSERT INTO public.seat_plans (slug, name, description, seat_limit, device_limit_per_seat, price_cents, currency, is_default, metadata) VALUES
  ('starter', 'Starter', 'Baseline plan. Matches the Prime repo footprint.', 4, 2, 0, 'USD', true, '{"tier":1}'),
  ('growth',  'Growth',  'For small teams scaling past Prime baseline.',     10, 3, 4900,  'USD', false, '{"tier":2}'),
  ('pro',     'Pro',     'Multi-team operations with higher seat ceiling.',  25, 5, 14900, 'USD', false, '{"tier":3}'),
  ('enterprise', 'Enterprise', 'High-volume tenant. Talk to sales for custom caps.', 100, 10, 49900, 'USD', false, '{"tier":4}');
