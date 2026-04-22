-- Module config version history / drafts
CREATE TABLE public.module_config_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  clone_id uuid NOT NULL,
  module_ids uuid[] NOT NULL DEFAULT '{}',
  label text NOT NULL DEFAULT 'draft',
  is_active boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.module_config_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators can read module_config_snapshots"
  ON public.module_config_snapshots FOR SELECT
  TO authenticated
  USING (is_operator(auth.uid()));

CREATE POLICY "Operators can insert module_config_snapshots"
  ON public.module_config_snapshots FOR INSERT
  TO authenticated
  WITH CHECK (is_operator(auth.uid()));

CREATE POLICY "Admins can delete module_config_snapshots"
  ON public.module_config_snapshots FOR DELETE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_module_config_snapshots_clone ON public.module_config_snapshots(clone_id);

-- Add dependency/incompatibility columns to modules
ALTER TABLE public.modules
  ADD COLUMN IF NOT EXISTS requires text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS incompatible_with text[] NOT NULL DEFAULT '{}';