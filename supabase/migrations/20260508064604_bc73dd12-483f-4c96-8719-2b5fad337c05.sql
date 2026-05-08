-- Update trigger so every new signup gets at least the 'user' role.
-- The first user still becomes super_admin (existing behavior preserved).
CREATE OR REPLACE FUNCTION public.bootstrap_first_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- First account ever becomes super_admin
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'super_admin') THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'super_admin')
    ON CONFLICT DO NOTHING;
    RETURN NEW;
  END IF;

  -- Every other new account gets the baseline 'user' role so they can sign in
  -- and land in the app instead of hitting "Access denied".
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$function$;

-- Backfill: any existing auth user without ANY role gets 'user'
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'user'::app_role
FROM auth.users u
LEFT JOIN public.user_roles r ON r.user_id = u.id
WHERE r.id IS NULL
ON CONFLICT DO NOTHING;