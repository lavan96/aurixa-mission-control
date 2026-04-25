-- ============ ENUMS ============
CREATE TYPE public.brand_profile_status AS ENUM ('draft', 'published', 'archived');
CREATE TYPE public.brand_assignment_status AS ENUM ('pending', 'applied', 'drifted', 'failed');

-- ============ clone_brand_profiles ============
CREATE TABLE public.clone_brand_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  status public.brand_profile_status NOT NULL DEFAULT 'draft',
  is_default BOOLEAN NOT NULL DEFAULT false,
  version INTEGER NOT NULL DEFAULT 1,
  brand_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  report_contact JSONB NOT NULL DEFAULT '{}'::jsonb,
  asset_manifest JSONB NOT NULL DEFAULT '[]'::jsonb,
  config_hash TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_by UUID,
  published_at TIMESTAMPTZ,
  published_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX one_default_brand_profile
  ON public.clone_brand_profiles ((is_default))
  WHERE is_default = true;

CREATE INDEX idx_brand_profiles_status ON public.clone_brand_profiles (status);
CREATE INDEX idx_brand_profiles_tags ON public.clone_brand_profiles USING GIN (tags);

ALTER TABLE public.clone_brand_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators view brand profiles"
  ON public.clone_brand_profiles FOR SELECT TO authenticated
  USING (public.is_operator(auth.uid()));

CREATE POLICY "Operators insert brand profiles"
  ON public.clone_brand_profiles FOR INSERT TO authenticated
  WITH CHECK (public.is_operator(auth.uid()));

CREATE POLICY "Operators update brand profiles"
  ON public.clone_brand_profiles FOR UPDATE TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));

CREATE POLICY "Admins delete brand profiles"
  ON public.clone_brand_profiles FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_brand_profiles_updated_at
  BEFORE UPDATE ON public.clone_brand_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ clone_brand_assignments ============
CREATE TABLE public.clone_brand_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  clone_id UUID NOT NULL UNIQUE,
  profile_id UUID NOT NULL REFERENCES public.clone_brand_profiles(id) ON DELETE RESTRICT,
  status public.brand_assignment_status NOT NULL DEFAULT 'pending',
  applied_config_hash TEXT,
  applied_at TIMESTAMPTZ,
  applied_by UUID,
  last_drift_check_at TIMESTAMPTZ,
  drift_summary TEXT,
  error_message TEXT,
  overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_brand_assignments_profile ON public.clone_brand_assignments (profile_id);
CREATE INDEX idx_brand_assignments_status ON public.clone_brand_assignments (status);

ALTER TABLE public.clone_brand_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators view brand assignments"
  ON public.clone_brand_assignments FOR SELECT TO authenticated
  USING (public.is_operator(auth.uid()));

CREATE POLICY "Operators insert brand assignments"
  ON public.clone_brand_assignments FOR INSERT TO authenticated
  WITH CHECK (public.is_operator(auth.uid()));

CREATE POLICY "Operators update brand assignments"
  ON public.clone_brand_assignments FOR UPDATE TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));

CREATE POLICY "Admins delete brand assignments"
  ON public.clone_brand_assignments FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_brand_assignments_updated_at
  BEFORE UPDATE ON public.clone_brand_assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ clone_brand_history ============
CREATE TABLE public.clone_brand_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  clone_id UUID NOT NULL,
  profile_id UUID,
  profile_version INTEGER,
  config_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  config_hash TEXT,
  status public.brand_assignment_status NOT NULL DEFAULT 'applied',
  pushed_by UUID,
  cascade_event_id UUID,
  error_message TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_brand_history_clone ON public.clone_brand_history (clone_id, created_at DESC);
CREATE INDEX idx_brand_history_profile ON public.clone_brand_history (profile_id);

ALTER TABLE public.clone_brand_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators view brand history"
  ON public.clone_brand_history FOR SELECT TO authenticated
  USING (public.is_operator(auth.uid()));

CREATE POLICY "Operators insert brand history"
  ON public.clone_brand_history FOR INSERT TO authenticated
  WITH CHECK (public.is_operator(auth.uid()));

-- ============ Auto-assign default profile to new clones ============
CREATE OR REPLACE FUNCTION public.auto_assign_default_brand_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _default_id UUID;
BEGIN
  SELECT id INTO _default_id
  FROM public.clone_brand_profiles
  WHERE is_default = true AND status = 'published'
  LIMIT 1;

  IF _default_id IS NOT NULL THEN
    INSERT INTO public.clone_brand_assignments (clone_id, profile_id, status)
    VALUES (NEW.id, _default_id, 'pending')
    ON CONFLICT (clone_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_assign_brand_profile
  AFTER INSERT ON public.clones
  FOR EACH ROW EXECUTE FUNCTION public.auto_assign_default_brand_profile();

-- ============ Storage bucket for brand assets ============
INSERT INTO storage.buckets (id, name, public)
VALUES ('brand-assets', 'brand-assets', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Brand assets are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'brand-assets');

CREATE POLICY "Operators upload brand assets"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'brand-assets' AND public.is_operator(auth.uid()));

CREATE POLICY "Operators update brand assets"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'brand-assets' AND public.is_operator(auth.uid()));

CREATE POLICY "Operators delete brand assets"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'brand-assets' AND public.is_operator(auth.uid()));