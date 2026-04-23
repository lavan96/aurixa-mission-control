
-- Hierarchy helper: numeric level per role (plpgsql to avoid enum cast issues)
CREATE OR REPLACE FUNCTION public.role_level(_role public.app_role)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  RETURN CASE _role::text
    WHEN 'super_admin' THEN 100
    WHEN 'admin'       THEN 80
    WHEN 'operator'    THEN 50
    WHEN 'user'        THEN 10
    ELSE 0
  END;
END;
$$;

-- Highest role level for a user
CREATE OR REPLACE FUNCTION public.highest_role_level(_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _level integer;
BEGIN
  SELECT COALESCE(MAX(public.role_level(role)), 0) INTO _level
  FROM public.user_roles
  WHERE user_id = _user_id;
  RETURN _level;
END;
$$;

-- Can this user assign the given role?
CREATE OR REPLACE FUNCTION public.can_assign_role(_assigner_id uuid, _target_role public.app_role)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.highest_role_level(_assigner_id) > public.role_level(_target_role);
END;
$$;

-- Can this user manage (change/remove roles for) the target user?
CREATE OR REPLACE FUNCTION public.can_manage_user(_manager_id uuid, _target_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.highest_role_level(_manager_id) > public.highest_role_level(_target_user_id);
END;
$$;

-- Update is_operator to include super_admin
CREATE OR REPLACE FUNCTION public.is_operator(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('super_admin', 'admin', 'operator')
  )
$$;

-- Update bootstrap_first_admin to grant super_admin
CREATE OR REPLACE FUNCTION public.bootstrap_first_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'super_admin') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'super_admin');
  END IF;
  RETURN NEW;
END;
$$;

-- Guardrail: prevent removing the last super_admin
CREATE OR REPLACE FUNCTION public.guard_last_super_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.role = 'super_admin' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE role = 'super_admin' AND id <> OLD.id
    ) THEN
      RAISE EXCEPTION 'Cannot remove the last super_admin from the system';
    END IF;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS guard_last_super_admin_delete ON public.user_roles;
CREATE TRIGGER guard_last_super_admin_delete
  BEFORE DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.guard_last_super_admin();

DROP TRIGGER IF EXISTS guard_last_super_admin_update ON public.user_roles;
CREATE TRIGGER guard_last_super_admin_update
  BEFORE UPDATE ON public.user_roles
  FOR EACH ROW
  WHEN (OLD.role = 'super_admin' AND NEW.role <> 'super_admin')
  EXECUTE FUNCTION public.guard_last_super_admin();

-- Guardrail: enforce hierarchy on role assignment
CREATE OR REPLACE FUNCTION public.enforce_role_hierarchy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.assigned_by IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT public.can_assign_role(NEW.assigned_by, NEW.role) THEN
    RAISE EXCEPTION 'Insufficient privileges: cannot assign role %', NEW.role;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_role_hierarchy_insert ON public.user_roles;
CREATE TRIGGER enforce_role_hierarchy_insert
  BEFORE INSERT ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_role_hierarchy();

DROP TRIGGER IF EXISTS enforce_role_hierarchy_update ON public.user_roles;
CREATE TRIGGER enforce_role_hierarchy_update
  BEFORE UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_role_hierarchy();

-- Replace flat RLS policies with hierarchy-aware ones
DROP POLICY IF EXISTS "Admins can read all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can insert roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can update roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can delete roles" ON public.user_roles;

CREATE POLICY "Admins and super_admins can read all roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')
  );

CREATE POLICY "Hierarchy-enforced role assignment"
  ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (
    public.can_assign_role(auth.uid(), role)
    AND assigned_by = auth.uid()
  );

CREATE POLICY "Hierarchy-enforced role update"
  ON public.user_roles FOR UPDATE TO authenticated
  USING (
    public.can_manage_user(auth.uid(), user_id)
  );

CREATE POLICY "Hierarchy-enforced role deletion"
  ON public.user_roles FOR DELETE TO authenticated
  USING (
    public.can_manage_user(auth.uid(), user_id)
  );

-- Promote earliest existing admin to super_admin
UPDATE public.user_roles
SET role = 'super_admin'
WHERE id = (
  SELECT id FROM public.user_roles
  WHERE role = 'admin'
  ORDER BY created_at ASC
  LIMIT 1
);
