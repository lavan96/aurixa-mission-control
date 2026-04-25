-- 1. Extend the schedule-kind enum with brand_sync
ALTER TYPE public.cascade_schedule_kind ADD VALUE IF NOT EXISTS 'brand_sync';

-- 2. Index for fast lookup of "all clones assigned to profile X"
CREATE INDEX IF NOT EXISTS idx_clone_brand_assignments_profile_id
  ON public.clone_brand_assignments (profile_id);

-- 3. When a published brand profile is updated (or freshly published),
--    flag every assignment to it as pending so the next brand_sync run
--    or manual push re-applies it. We compare config_hash to detect real changes.
CREATE OR REPLACE FUNCTION public.flag_assignments_on_brand_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Only act on published profiles
  IF NEW.status <> 'published' THEN
    RETURN NEW;
  END IF;

  -- Trigger re-cascade if:
  --   a) profile just transitioned into published, OR
  --   b) config_hash changed while published
  IF (TG_OP = 'INSERT')
     OR (OLD.status IS DISTINCT FROM 'published' AND NEW.status = 'published')
     OR (OLD.config_hash IS DISTINCT FROM NEW.config_hash) THEN
    UPDATE public.clone_brand_assignments
    SET status = 'pending',
        drift_summary = 'Profile updated — awaiting cascade',
        updated_at = now()
    WHERE profile_id = NEW.id
      AND status <> 'pending';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_flag_assignments_on_brand_change ON public.clone_brand_profiles;
CREATE TRIGGER trg_flag_assignments_on_brand_change
AFTER INSERT OR UPDATE ON public.clone_brand_profiles
FOR EACH ROW
EXECUTE FUNCTION public.flag_assignments_on_brand_change();