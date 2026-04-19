
-- ============ ENUMS ============
CREATE TYPE public.app_role AS ENUM ('admin', 'operator');
CREATE TYPE public.provisioning_method AS ENUM ('fork', 'template', 'clone');
CREATE TYPE public.sync_status AS ENUM ('in_sync', 'behind', 'cascading', 'failed', 'unknown');
CREATE TYPE public.module_status AS ENUM ('proposed', 'approved', 'archived');
CREATE TYPE public.cascade_mode AS ENUM ('pr', 'auto_merge', 'notify');
CREATE TYPE public.cascade_trigger AS ENUM ('manual', 'commit', 'scheduled');
CREATE TYPE public.cascade_event_status AS ENUM ('pending', 'running', 'completed', 'failed', 'partial');
CREATE TYPE public.cascade_result_status AS ENUM ('queued', 'pushing', 'succeeded', 'failed', 'pr_opened', 'skipped');

-- ============ HELPERS ============
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles viewable by authenticated"
  ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ USER_ROLES ============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.is_operator(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('admin', 'operator')
  )
$$;

CREATE POLICY "Users can read own roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Admins can read all roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can insert roles"
  ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update roles"
  ON public.user_roles FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete roles"
  ON public.user_roles FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Bootstrap: first signed-up user becomes admin
CREATE OR REPLACE FUNCTION public.bootstrap_first_admin()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_bootstrap_admin
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.bootstrap_first_admin();

-- ============ PRIME_CONFIG (singleton) ============
CREATE TABLE public.prime_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  github_owner TEXT NOT NULL,
  github_repo TEXT NOT NULL,
  default_branch TEXT NOT NULL DEFAULT 'main',
  github_app_installation_id TEXT,
  default_clone_org TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.prime_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators can read prime config"
  ON public.prime_config FOR SELECT TO authenticated
  USING (public.is_operator(auth.uid()));
CREATE POLICY "Admins can write prime config"
  ON public.prime_config FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_prime_config_updated_at
  BEFORE UPDATE ON public.prime_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ CLONES ============
CREATE TABLE public.clones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  tags TEXT[] DEFAULT '{}',
  provisioning_method public.provisioning_method NOT NULL,
  github_owner TEXT NOT NULL,
  github_repo TEXT NOT NULL,
  github_url TEXT,
  default_branch TEXT NOT NULL DEFAULT 'main',
  lovable_project_id TEXT,
  lovable_project_url TEXT,
  deploy_url TEXT,
  cloudflare_zone_id TEXT,
  cloudflare_enabled BOOLEAN NOT NULL DEFAULT false,
  sync_status public.sync_status NOT NULL DEFAULT 'unknown',
  last_synced_sha TEXT,
  commits_behind INTEGER NOT NULL DEFAULT 0,
  last_cascade_at TIMESTAMPTZ,
  owner_user_id UUID REFERENCES auth.users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.clones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators can read clones"
  ON public.clones FOR SELECT TO authenticated
  USING (public.is_operator(auth.uid()));
CREATE POLICY "Operators can insert clones"
  ON public.clones FOR INSERT TO authenticated
  WITH CHECK (public.is_operator(auth.uid()));
CREATE POLICY "Operators can update clones"
  ON public.clones FOR UPDATE TO authenticated
  USING (public.is_operator(auth.uid()));
CREATE POLICY "Admins can delete clones"
  ON public.clones FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_clones_updated_at
  BEFORE UPDATE ON public.clones
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_clones_sync_status ON public.clones(sync_status);
CREATE INDEX idx_clones_tags ON public.clones USING GIN(tags);

-- ============ MODULES ============
CREATE TABLE public.modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  file_globs TEXT[] NOT NULL DEFAULT '{}',
  routes TEXT[] NOT NULL DEFAULT '{}',
  dependencies TEXT[] NOT NULL DEFAULT '{}',
  status public.module_status NOT NULL DEFAULT 'proposed',
  detected_by_ai BOOLEAN NOT NULL DEFAULT true,
  ai_confidence NUMERIC(3,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.modules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators can read modules"
  ON public.modules FOR SELECT TO authenticated
  USING (public.is_operator(auth.uid()));
CREATE POLICY "Operators can write modules"
  ON public.modules FOR ALL TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));

CREATE TRIGGER update_modules_updated_at
  BEFORE UPDATE ON public.modules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ CLONE_MODULES ============
CREATE TABLE public.clone_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clone_id UUID NOT NULL REFERENCES public.clones(id) ON DELETE CASCADE,
  module_id UUID NOT NULL REFERENCES public.modules(id) ON DELETE CASCADE,
  version TEXT,
  installed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  installed_by UUID REFERENCES auth.users(id),
  UNIQUE(clone_id, module_id)
);
ALTER TABLE public.clone_modules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators can read clone_modules"
  ON public.clone_modules FOR SELECT TO authenticated
  USING (public.is_operator(auth.uid()));
CREATE POLICY "Operators can write clone_modules"
  ON public.clone_modules FOR ALL TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));

CREATE INDEX idx_clone_modules_clone ON public.clone_modules(clone_id);
CREATE INDEX idx_clone_modules_module ON public.clone_modules(module_id);

-- ============ CASCADE_EVENTS ============
CREATE TABLE public.cascade_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger public.cascade_trigger NOT NULL,
  source_sha TEXT,
  source_branch TEXT,
  mode public.cascade_mode NOT NULL,
  scope_filter JSONB NOT NULL DEFAULT '{}'::jsonb,
  status public.cascade_event_status NOT NULL DEFAULT 'pending',
  summary TEXT,
  initiated_by UUID REFERENCES auth.users(id),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.cascade_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators can read cascade_events"
  ON public.cascade_events FOR SELECT TO authenticated
  USING (public.is_operator(auth.uid()));
CREATE POLICY "Operators can write cascade_events"
  ON public.cascade_events FOR ALL TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));

CREATE TRIGGER update_cascade_events_updated_at
  BEFORE UPDATE ON public.cascade_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_cascade_events_status ON public.cascade_events(status);
CREATE INDEX idx_cascade_events_created ON public.cascade_events(created_at DESC);

-- ============ CASCADE_RESULTS ============
CREATE TABLE public.cascade_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cascade_event_id UUID NOT NULL REFERENCES public.cascade_events(id) ON DELETE CASCADE,
  clone_id UUID NOT NULL REFERENCES public.clones(id) ON DELETE CASCADE,
  status public.cascade_result_status NOT NULL DEFAULT 'queued',
  pr_url TEXT,
  commit_sha TEXT,
  files_changed INTEGER NOT NULL DEFAULT 0,
  diff_summary TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.cascade_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators can read cascade_results"
  ON public.cascade_results FOR SELECT TO authenticated
  USING (public.is_operator(auth.uid()));
CREATE POLICY "Operators can write cascade_results"
  ON public.cascade_results FOR ALL TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));

CREATE TRIGGER update_cascade_results_updated_at
  BEFORE UPDATE ON public.cascade_results
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_cascade_results_event ON public.cascade_results(cascade_event_id);
CREATE INDEX idx_cascade_results_clone ON public.cascade_results(clone_id);

-- ============ AUDIT_LOG ============
CREATE TABLE public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators can read audit_log"
  ON public.audit_log FOR SELECT TO authenticated
  USING (public.is_operator(auth.uid()));
CREATE POLICY "Operators can append audit_log"
  ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (public.is_operator(auth.uid()));

CREATE INDEX idx_audit_log_created ON public.audit_log(created_at DESC);
CREATE INDEX idx_audit_log_entity ON public.audit_log(entity_type, entity_id);
