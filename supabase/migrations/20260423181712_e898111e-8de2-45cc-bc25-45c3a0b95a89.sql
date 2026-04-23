
-- Detection runs table
CREATE TABLE public.module_detection_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy text NOT NULL DEFAULT 'hybrid',
  status text NOT NULL DEFAULT 'pending',
  tree_hash text,
  file_count integer DEFAULT 0,
  sampled_file_count integer DEFAULT 0,
  dependency_count integer DEFAULT 0,
  pass_count integer DEFAULT 0,
  passes jsonb DEFAULT '[]'::jsonb,
  proposed_modules integer DEFAULT 0,
  inserted_modules integer DEFAULT 0,
  updated_modules integer DEFAULT 0,
  orphan_files_found integer DEFAULT 0,
  delta_mode boolean DEFAULT false,
  previous_run_id uuid REFERENCES public.module_detection_runs(id),
  error_message text,
  parameters jsonb DEFAULT '{}'::jsonb,
  initiated_by uuid,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.module_detection_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators can view detection runs"
  ON public.module_detection_runs FOR SELECT
  TO authenticated
  USING (public.is_operator(auth.uid()));

CREATE POLICY "Operators can insert detection runs"
  ON public.module_detection_runs FOR INSERT
  TO authenticated
  WITH CHECK (public.is_operator(auth.uid()));

CREATE POLICY "Operators can update detection runs"
  ON public.module_detection_runs FOR UPDATE
  TO authenticated
  USING (public.is_operator(auth.uid()));

CREATE TRIGGER update_module_detection_runs_updated_at
  BEFORE UPDATE ON public.module_detection_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Import graph edges table
CREATE TABLE public.module_import_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  detection_run_id uuid NOT NULL REFERENCES public.module_detection_runs(id) ON DELETE CASCADE,
  source_file text NOT NULL,
  target_file text NOT NULL,
  import_type text NOT NULL DEFAULT 'static',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_import_edges_run ON public.module_import_edges(detection_run_id);
CREATE INDEX idx_import_edges_source ON public.module_import_edges(source_file);

ALTER TABLE public.module_import_edges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators can view import edges"
  ON public.module_import_edges FOR SELECT
  TO authenticated
  USING (public.is_operator(auth.uid()));

CREATE POLICY "Operators can insert import edges"
  ON public.module_import_edges FOR INSERT
  TO authenticated
  WITH CHECK (public.is_operator(auth.uid()));

-- Module drift alerts table
CREATE TABLE public.module_drift_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  detection_run_id uuid REFERENCES public.module_detection_runs(id) ON DELETE CASCADE,
  module_id uuid REFERENCES public.modules(id) ON DELETE CASCADE,
  alert_type text NOT NULL,
  file_path text,
  suggested_module_slug text,
  reasoning text,
  severity text NOT NULL DEFAULT 'info',
  resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_drift_alerts_module ON public.module_drift_alerts(module_id);
CREATE INDEX idx_drift_alerts_run ON public.module_drift_alerts(detection_run_id);

ALTER TABLE public.module_drift_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators can view drift alerts"
  ON public.module_drift_alerts FOR SELECT
  TO authenticated
  USING (public.is_operator(auth.uid()));

CREATE POLICY "Operators can insert drift alerts"
  ON public.module_drift_alerts FOR INSERT
  TO authenticated
  WITH CHECK (public.is_operator(auth.uid()));

CREATE POLICY "Operators can update drift alerts"
  ON public.module_drift_alerts FOR UPDATE
  TO authenticated
  USING (public.is_operator(auth.uid()));

-- Add new columns to modules table
ALTER TABLE public.modules
  ADD COLUMN IF NOT EXISTS cohesion_score numeric,
  ADD COLUMN IF NOT EXISTS coupling_score numeric,
  ADD COLUMN IF NOT EXISTS detection_run_id uuid REFERENCES public.module_detection_runs(id),
  ADD COLUMN IF NOT EXISTS ai_reasoning text,
  ADD COLUMN IF NOT EXISTS tree_snapshot_hash text,
  ADD COLUMN IF NOT EXISTS orphan_file_count integer DEFAULT 0;
