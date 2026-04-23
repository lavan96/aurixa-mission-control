
-- Backend status enum
CREATE TYPE public.clone_backend_status AS ENUM (
  'pending',
  'provisioning',
  'migrating',
  'seeding_admin',
  'ready',
  'failed',
  'suspended'
);

-- Table to store each clone's dedicated Supabase backend credentials and status
CREATE TABLE public.clone_backends (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  clone_id uuid NOT NULL UNIQUE,
  supabase_project_ref text,
  supabase_url text,
  anon_key text,
  service_role_key text,
  db_pass text,
  region text NOT NULL DEFAULT 'us-east-1',
  admin_email text,
  migration_version text,
  status public.clone_backend_status NOT NULL DEFAULT 'pending',
  error_message text,
  status_detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.clone_backends ENABLE ROW LEVEL SECURITY;

-- Operators can read
CREATE POLICY "Operators can read clone_backends"
  ON public.clone_backends FOR SELECT
  TO authenticated
  USING (public.is_operator(auth.uid()));

-- Admins can write (insert/update/delete)
CREATE POLICY "Admins can write clone_backends"
  ON public.clone_backends FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Auto-update timestamp
CREATE TRIGGER update_clone_backends_updated_at
  BEFORE UPDATE ON public.clone_backends
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
