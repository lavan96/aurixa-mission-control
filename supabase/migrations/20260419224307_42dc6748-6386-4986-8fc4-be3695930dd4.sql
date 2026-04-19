ALTER TABLE public.clones
  ADD COLUMN IF NOT EXISTS drift_suggestions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS last_drift_check_at timestamptz;