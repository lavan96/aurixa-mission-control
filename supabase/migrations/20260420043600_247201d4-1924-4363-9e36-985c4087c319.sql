-- Cascade templates: named, reusable scope+mode presets
CREATE TABLE public.cascade_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  description text,
  mode public.cascade_mode NOT NULL DEFAULT 'pr',
  scope text NOT NULL DEFAULT 'all',           -- 'all' | 'tagged' | 'selected'
  tags text[] NOT NULL DEFAULT '{}',           -- only used when scope = 'tagged'
  clone_ids uuid[] NOT NULL DEFAULT '{}',      -- only used when scope = 'selected'
  created_by uuid,
  use_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cascade_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators can read cascade_templates"
  ON public.cascade_templates FOR SELECT TO authenticated
  USING (public.is_operator(auth.uid()));

CREATE POLICY "Operators can write cascade_templates"
  ON public.cascade_templates FOR ALL TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));

CREATE TRIGGER update_cascade_templates_updated_at
  BEFORE UPDATE ON public.cascade_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_cascade_templates_last_used ON public.cascade_templates (last_used_at DESC NULLS LAST);