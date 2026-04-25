-- ─── Versioning ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clone_brand_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.clone_brand_profiles(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  config_hash TEXT,
  brand_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  report_contact JSONB NOT NULL DEFAULT '{}'::jsonb,
  asset_manifest JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  published_by UUID,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (profile_id, version)
);
CREATE INDEX IF NOT EXISTS idx_clone_brand_versions_profile
  ON public.clone_brand_versions (profile_id, version DESC);

ALTER TABLE public.clone_brand_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators view brand versions"
  ON public.clone_brand_versions FOR SELECT TO authenticated
  USING (public.is_operator(auth.uid()));
CREATE POLICY "Operators insert brand versions"
  ON public.clone_brand_versions FOR INSERT TO authenticated
  WITH CHECK (public.is_operator(auth.uid()));
CREATE POLICY "Admins delete brand versions"
  ON public.clone_brand_versions FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- ─── Asset variants ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clone_brand_asset_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.clone_brand_profiles(id) ON DELETE CASCADE,
  source_path TEXT NOT NULL,
  variant_path TEXT NOT NULL,
  variant_kind TEXT NOT NULL,           -- e.g. 'favicon-32', 'logo-2x', 'webp'
  width INTEGER,
  height INTEGER,
  content_type TEXT NOT NULL,
  byte_size INTEGER,
  public_url TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (profile_id, variant_path)
);
CREATE INDEX IF NOT EXISTS idx_brand_asset_variants_profile
  ON public.clone_brand_asset_variants (profile_id);
CREATE INDEX IF NOT EXISTS idx_brand_asset_variants_source
  ON public.clone_brand_asset_variants (profile_id, source_path);

ALTER TABLE public.clone_brand_asset_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators view brand asset variants"
  ON public.clone_brand_asset_variants FOR SELECT TO authenticated
  USING (public.is_operator(auth.uid()));
CREATE POLICY "Operators write brand asset variants"
  ON public.clone_brand_asset_variants FOR ALL TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));

-- ─── Per-clone overrides on assignments ──────────────────────────────
ALTER TABLE public.clone_brand_assignments
  ADD COLUMN IF NOT EXISTS override_keys TEXT[] NOT NULL DEFAULT '{}'::text[];

-- Pointer to the currently-published version snapshot
ALTER TABLE public.clone_brand_profiles
  ADD COLUMN IF NOT EXISTS published_version_id UUID
    REFERENCES public.clone_brand_versions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_brand_assignments_status
  ON public.clone_brand_assignments (status);

-- ─── Snapshot trigger: when a profile is (re)published, write a version row ──
CREATE OR REPLACE FUNCTION public.snapshot_brand_version_on_publish()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _new_version INTEGER;
  _version_id UUID;
  _should_snapshot BOOLEAN := false;
BEGIN
  IF NEW.status <> 'published' THEN
    RETURN NEW;
  END IF;

  IF (TG_OP = 'INSERT') THEN
    _should_snapshot := true;
  ELSIF (OLD.status IS DISTINCT FROM 'published' AND NEW.status = 'published') THEN
    _should_snapshot := true;
  ELSIF (OLD.config_hash IS DISTINCT FROM NEW.config_hash) THEN
    _should_snapshot := true;
  END IF;

  IF NOT _should_snapshot THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(MAX(version), 0) + 1 INTO _new_version
  FROM public.clone_brand_versions
  WHERE profile_id = NEW.id;

  INSERT INTO public.clone_brand_versions (
    profile_id, version, config_hash, brand_config, report_contact,
    asset_manifest, published_by, published_at
  ) VALUES (
    NEW.id, _new_version, NEW.config_hash, NEW.brand_config, NEW.report_contact,
    NEW.asset_manifest, NEW.published_by, COALESCE(NEW.published_at, now())
  )
  RETURNING id INTO _version_id;

  -- Bump the profile's denormalised version + pointer.
  UPDATE public.clone_brand_profiles
  SET version = _new_version,
      published_version_id = _version_id
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_snapshot_brand_version ON public.clone_brand_profiles;
CREATE TRIGGER trg_snapshot_brand_version
AFTER INSERT OR UPDATE OF status, config_hash
ON public.clone_brand_profiles
FOR EACH ROW
EXECUTE FUNCTION public.snapshot_brand_version_on_publish();