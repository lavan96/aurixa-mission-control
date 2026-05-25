
CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.highest_role_level(_user_id) >= 80
$$;

DROP POLICY IF EXISTS "Admins can write prime config" ON public.prime_config;
CREATE POLICY "Admins can write prime config"
  ON public.prime_config
  FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
