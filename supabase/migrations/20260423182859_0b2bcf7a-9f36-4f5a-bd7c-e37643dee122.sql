-- Add rejected to module_status enum
ALTER TYPE module_status ADD VALUE IF NOT EXISTS 'rejected';

-- Add approval/rejection audit columns to modules
ALTER TABLE public.modules
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

-- Module cascade jobs table
CREATE TABLE public.module_cascade_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_ids uuid[] NOT NULL DEFAULT '{}',
  clone_ids uuid[] NOT NULL DEFAULT '{}',
  cascade_event_id uuid,
  status text NOT NULL DEFAULT 'pending',
  initiated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'
);

ALTER TABLE public.module_cascade_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators can view module_cascade_jobs"
  ON public.module_cascade_jobs FOR SELECT TO authenticated
  USING (is_operator(auth.uid()));

CREATE POLICY "Operators can insert module_cascade_jobs"
  ON public.module_cascade_jobs FOR INSERT TO authenticated
  WITH CHECK (is_operator(auth.uid()));

CREATE POLICY "Operators can update module_cascade_jobs"
  ON public.module_cascade_jobs FOR UPDATE TO authenticated
  USING (is_operator(auth.uid()));

CREATE TRIGGER update_module_cascade_jobs_updated_at
  BEFORE UPDATE ON public.module_cascade_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();