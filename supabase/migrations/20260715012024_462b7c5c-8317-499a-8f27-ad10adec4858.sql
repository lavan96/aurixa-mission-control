
-- G13 — Signed handoff record: terms registry + snapshot manifest + signed bundle

CREATE TABLE IF NOT EXISTS public.handoff_terms_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL UNIQUE,
  title text NOT NULL,
  body_md text NOT NULL,
  terms_hash text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  effective_at timestamptz,
  retired_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.handoff_terms_versions TO authenticated;
GRANT ALL ON public.handoff_terms_versions TO service_role;

ALTER TABLE public.handoff_terms_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage terms versions"
  ON public.handoff_terms_versions FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE UNIQUE INDEX IF NOT EXISTS idx_handoff_terms_one_active
  ON public.handoff_terms_versions ((true))
  WHERE is_active = true;

CREATE TRIGGER trg_handoff_terms_versions_updated
  BEFORE UPDATE ON public.handoff_terms_versions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.handoff_contracts
  ADD COLUMN IF NOT EXISTS snapshot_manifest jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS signature_bundle_sha256 text,
  ADD COLUMN IF NOT EXISTS document_storage_path text,
  ADD COLUMN IF NOT EXISTS terms_version_id uuid REFERENCES public.handoff_terms_versions(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Admins read handoff contracts') THEN
    CREATE POLICY "Admins read handoff contracts" ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'handoff-contracts' AND public.is_admin(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Admins write handoff contracts') THEN
    CREATE POLICY "Admins write handoff contracts" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'handoff-contracts' AND public.is_admin(auth.uid()));
  END IF;
END $$;
