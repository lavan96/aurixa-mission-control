ALTER TABLE public.clones
  ADD COLUMN IF NOT EXISTS isolated_tenant boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.clones.isolated_tenant IS
  'When true, this clone must have its own dedicated Supabase backend. Enforced by triggers on clones + clone_backends.';

CREATE OR REPLACE FUNCTION public.clone_has_dedicated_backend(_clone_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clone_backends
    WHERE clone_id = _clone_id
      AND status::text NOT IN ('failed', 'deleted', 'destroyed')
  );
$$;

CREATE OR REPLACE FUNCTION public.clone_requires_backend(_clone_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT isolated_tenant FROM public.clones WHERE id = _clone_id), false);
$$;

CREATE OR REPLACE FUNCTION public.enforce_isolated_tenant_backend()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.isolated_tenant = true
     AND COALESCE(OLD.isolated_tenant, false) = false
     AND NOT public.clone_has_dedicated_backend(NEW.id) THEN
    RAISE EXCEPTION
      'Cannot mark clone % as isolated_tenant without a dedicated backend. Provision the backend first.',
      NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_isolated_tenant_backend ON public.clones;
CREATE TRIGGER trg_enforce_isolated_tenant_backend
BEFORE UPDATE OF isolated_tenant ON public.clones
FOR EACH ROW EXECUTE FUNCTION public.enforce_isolated_tenant_backend();

CREATE OR REPLACE FUNCTION public.protect_isolated_tenant_backend()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _iso boolean;
BEGIN
  SELECT isolated_tenant INTO _iso FROM public.clones WHERE id = OLD.clone_id;
  IF COALESCE(_iso, false) = true THEN
    RAISE EXCEPTION
      'Cannot delete backend for clone %: it is flagged isolated_tenant. Unset the flag first, then delete.',
      OLD.clone_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_isolated_tenant_backend ON public.clone_backends;
CREATE TRIGGER trg_protect_isolated_tenant_backend
BEFORE DELETE ON public.clone_backends
FOR EACH ROW EXECUTE FUNCTION public.protect_isolated_tenant_backend();

CREATE OR REPLACE VIEW public.clones_missing_isolated_backend AS
SELECT c.id AS clone_id,
       c.name,
       c.slug,
       c.provisioning_method,
       c.owner_user_id,
       c.created_at,
       b.status::text AS backend_status
  FROM public.clones c
  LEFT JOIN public.clone_backends b ON b.clone_id = c.id
 WHERE c.isolated_tenant = true
   AND (b.id IS NULL OR b.status::text IN ('failed', 'deleted', 'destroyed'));

GRANT SELECT ON public.clones_missing_isolated_backend TO authenticated;
GRANT SELECT ON public.clones_missing_isolated_backend TO service_role;
