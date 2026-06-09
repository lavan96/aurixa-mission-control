
-- 1) Revoke EXECUTE on all SECURITY DEFINER functions from anon and PUBLIC.
-- Authenticated and service_role retain access (needed for RLS helpers and server calls).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC, anon',
                   r.nspname, r.proname, r.args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO authenticated, service_role',
                   r.nspname, r.proname, r.args);
  END LOOP;
END $$;

-- 2) Restrict listing on brand-assets bucket. Public reads of specific object
-- URLs still work (CDN-level), but anonymous LIST via storage API is blocked.
DROP POLICY IF EXISTS "Brand assets are publicly readable" ON storage.objects;
CREATE POLICY "Brand assets readable by authenticated"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'brand-assets');
