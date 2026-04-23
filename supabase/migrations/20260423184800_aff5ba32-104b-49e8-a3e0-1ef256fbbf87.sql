-- Module library for storing versioned module definitions
CREATE TABLE public.module_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  route_path text,
  entry_file text NOT NULL,
  file_paths text[] NOT NULL DEFAULT '{}',
  file_count integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  source_detection_run_id uuid,
  source_module_id uuid,
  published_by uuid,
  published_at timestamptz NOT NULL DEFAULT now(),
  is_latest boolean NOT NULL DEFAULT true,
  tags text[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.module_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators can view module_library"
  ON public.module_library FOR SELECT TO authenticated
  USING (is_operator(auth.uid()));

CREATE POLICY "Operators can insert module_library"
  ON public.module_library FOR INSERT TO authenticated
  WITH CHECK (is_operator(auth.uid()));

CREATE POLICY "Operators can update module_library"
  ON public.module_library FOR UPDATE TO authenticated
  USING (is_operator(auth.uid()));

CREATE POLICY "Admins can delete module_library"
  ON public.module_library FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_module_library_updated_at
  BEFORE UPDATE ON public.module_library
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Add route-first columns to modules table
ALTER TABLE public.modules
  ADD COLUMN IF NOT EXISTS route_entry_file text,
  ADD COLUMN IF NOT EXISTS resolved_files text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS shared_by_modules text[] NOT NULL DEFAULT '{}';