
-- Backfill default device_limit_per_seat for existing plans (NULL = unlimited; set sane defaults)
UPDATE public.seat_plans SET device_limit_per_seat = COALESCE(device_limit_per_seat,
  CASE slug
    WHEN 'starter' THEN 2
    WHEN 'growth' THEN 3
    WHEN 'pro' THEN 5
    WHEN 'enterprise' THEN 10
    ELSE 3
  END);

-- Devices table — one row per (seat, device fingerprint)
CREATE TABLE public.clone_seat_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seat_id uuid NOT NULL REFERENCES public.clone_seats(id) ON DELETE CASCADE,
  clone_id uuid,
  external_user_id text NOT NULL,
  device_fingerprint text NOT NULL,
  device_label text,
  user_agent text,
  ip_address text,
  platform text,
  status text NOT NULL DEFAULT 'active', -- active | revoked
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX clone_seat_devices_seat_fp_unique
  ON public.clone_seat_devices (seat_id, device_fingerprint)
  WHERE status = 'active';
CREATE INDEX clone_seat_devices_seat_idx ON public.clone_seat_devices (seat_id, status);
CREATE INDEX clone_seat_devices_clone_idx ON public.clone_seat_devices (clone_id, status);
CREATE INDEX clone_seat_devices_last_seen_idx ON public.clone_seat_devices (last_seen_at DESC);

ALTER TABLE public.clone_seat_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators read clone_seat_devices" ON public.clone_seat_devices
  FOR SELECT TO authenticated USING (public.is_operator(auth.uid()));
CREATE POLICY "Operators write clone_seat_devices" ON public.clone_seat_devices
  FOR ALL TO authenticated USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));

CREATE TRIGGER clone_seat_devices_updated BEFORE UPDATE ON public.clone_seat_devices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seat audit needs new actions covered by existing free-text 'action' column. No schema change needed.

-- Recompute device_count for a seat
CREATE OR REPLACE FUNCTION public.recompute_seat_device_count(_seat_id uuid)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _count int;
BEGIN
  SELECT COUNT(*) INTO _count FROM public.clone_seat_devices
   WHERE seat_id = _seat_id AND status = 'active';
  UPDATE public.clone_seats SET device_count = _count, updated_at = now() WHERE id = _seat_id;
  RETURN _count;
END;
$$;

-- Register device (idempotent on (seat_id, device_fingerprint))
CREATE OR REPLACE FUNCTION public.register_device(
  _clone_id uuid,
  _external_user_id text,
  _device_fingerprint text,
  _device_label text DEFAULT NULL,
  _user_agent text DEFAULT NULL,
  _ip_address text DEFAULT NULL,
  _platform text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _seat public.clone_seats%ROWTYPE;
  _plan public.seat_plans%ROWTYPE;
  _ent  public.clone_seat_entitlements%ROWTYPE;
  _existing public.clone_seat_devices%ROWTYPE;
  _device_id uuid;
  _active int;
  _limit int;
BEGIN
  IF _device_fingerprint IS NULL OR length(trim(_device_fingerprint)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_fingerprint');
  END IF;

  SELECT * INTO _seat FROM public.clone_seats
   WHERE clone_id IS NOT DISTINCT FROM _clone_id
     AND external_user_id = _external_user_id
     AND status IN ('reserved','active')
   LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'seat_not_found');
  END IF;

  -- Idempotent re-register: same fingerprint -> heartbeat
  SELECT * INTO _existing FROM public.clone_seat_devices
   WHERE seat_id = _seat.id AND device_fingerprint = _device_fingerprint AND status = 'active'
   LIMIT 1;
  IF FOUND THEN
    UPDATE public.clone_seat_devices
       SET last_seen_at = now(),
           user_agent = COALESCE(_user_agent, user_agent),
           ip_address = COALESCE(_ip_address, ip_address),
           platform = COALESCE(_platform, platform),
           device_label = COALESCE(_device_label, device_label)
     WHERE id = _existing.id;
    SELECT COUNT(*) INTO _active FROM public.clone_seat_devices
     WHERE seat_id = _seat.id AND status = 'active';
    RETURN jsonb_build_object('ok', true, 'idempotent', true,
      'device_id', _existing.id, 'devices_active', _active);
  END IF;

  -- Resolve plan + per-seat device cap
  SELECT * INTO _ent FROM public.clone_seat_entitlements
   WHERE clone_id IS NOT DISTINCT FROM _clone_id;
  IF FOUND THEN
    SELECT * INTO _plan FROM public.seat_plans WHERE id = _ent.seat_plan_id;
  END IF;
  _limit := COALESCE(_plan.device_limit_per_seat, 0);

  SELECT COUNT(*) INTO _active FROM public.clone_seat_devices
   WHERE seat_id = _seat.id AND status = 'active';

  IF _limit > 0 AND _active >= _limit AND COALESCE(_plan.overage_policy, 'block') = 'block' THEN
    INSERT INTO public.seat_audit (clone_id, action, external_user_id, seat_id, metadata)
    VALUES (_clone_id, 'device_cap_hit', _external_user_id, _seat.id,
      jsonb_build_object('limit', _limit, 'active', _active, 'fingerprint_prefix', left(_device_fingerprint, 12)));
    RETURN jsonb_build_object('ok', false, 'error', 'device_limit_reached',
      'device_limit', _limit, 'devices_active', _active);
  END IF;

  INSERT INTO public.clone_seat_devices
    (seat_id, clone_id, external_user_id, device_fingerprint, device_label, user_agent, ip_address, platform)
  VALUES
    (_seat.id, _clone_id, _external_user_id, _device_fingerprint, _device_label, _user_agent, _ip_address, _platform)
  RETURNING id INTO _device_id;

  PERFORM public.recompute_seat_device_count(_seat.id);
  SELECT COUNT(*) INTO _active FROM public.clone_seat_devices
   WHERE seat_id = _seat.id AND status = 'active';

  INSERT INTO public.seat_audit (clone_id, action, external_user_id, seat_id, metadata)
  VALUES (_clone_id, 'device_register', _external_user_id, _seat.id,
    jsonb_build_object('device_id', _device_id, 'active', _active, 'limit', _limit,
                       'label', _device_label, 'platform', _platform));

  RETURN jsonb_build_object('ok', true, 'device_id', _device_id,
    'devices_active', _active, 'device_limit', _limit,
    'devices_remaining', CASE WHEN _limit > 0 THEN GREATEST(0, _limit - _active) ELSE NULL END);
END;
$$;

-- Heartbeat (no cap check, just bump last_seen)
CREATE OR REPLACE FUNCTION public.heartbeat_device(_device_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.clone_seat_devices
     SET last_seen_at = now()
   WHERE id = _device_id AND status = 'active';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'device_not_found'); END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Release (by device_id OR fingerprint+seat)
CREATE OR REPLACE FUNCTION public.release_device(
  _device_id uuid DEFAULT NULL,
  _clone_id uuid DEFAULT NULL,
  _external_user_id text DEFAULT NULL,
  _device_fingerprint text DEFAULT NULL,
  _reason text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _dev public.clone_seat_devices%ROWTYPE;
BEGIN
  IF _device_id IS NOT NULL THEN
    SELECT * INTO _dev FROM public.clone_seat_devices WHERE id = _device_id FOR UPDATE;
  ELSIF _device_fingerprint IS NOT NULL AND _external_user_id IS NOT NULL THEN
    SELECT d.* INTO _dev FROM public.clone_seat_devices d
      JOIN public.clone_seats s ON s.id = d.seat_id
     WHERE s.clone_id IS NOT DISTINCT FROM _clone_id
       AND s.external_user_id = _external_user_id
       AND d.device_fingerprint = _device_fingerprint
       AND d.status = 'active'
     LIMIT 1 FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', true, 'idempotent', true); END IF;
  IF _dev.status = 'revoked' THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true);
  END IF;
  UPDATE public.clone_seat_devices
     SET status = 'revoked', revoked_at = now(), revoked_reason = _reason
   WHERE id = _dev.id;
  PERFORM public.recompute_seat_device_count(_dev.seat_id);
  INSERT INTO public.seat_audit (clone_id, action, external_user_id, seat_id, metadata)
  VALUES (_dev.clone_id, 'device_release', _dev.external_user_id, _dev.seat_id,
    jsonb_build_object('device_id', _dev.id, 'reason', _reason));
  RETURN jsonb_build_object('ok', true, 'device_id', _dev.id);
END;
$$;

-- Auto-revoke devices when seat is removed
CREATE OR REPLACE FUNCTION public.cascade_revoke_devices_on_seat_remove()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'removed' AND OLD.status <> 'removed' THEN
    UPDATE public.clone_seat_devices
       SET status = 'revoked', revoked_at = now(), revoked_reason = COALESCE(revoked_reason, 'seat_removed')
     WHERE seat_id = NEW.id AND status = 'active';
    NEW.device_count := 0;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clone_seats_cascade_devices ON public.clone_seats;
CREATE TRIGGER clone_seats_cascade_devices
  BEFORE UPDATE ON public.clone_seats
  FOR EACH ROW EXECUTE FUNCTION public.cascade_revoke_devices_on_seat_remove();
