ALTER TABLE public.clone_backends
  ADD COLUMN IF NOT EXISTS queued_admin_password_enc text,
  ADD COLUMN IF NOT EXISTS queued_module_ids uuid[],
  ADD COLUMN IF NOT EXISTS queued_at timestamptz,
  ADD COLUMN IF NOT EXISTS worker_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS worker_finished_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS enqueued_by uuid;

CREATE INDEX IF NOT EXISTS idx_clone_backends_pending_queue
  ON public.clone_backends (queued_at)
  WHERE status = 'pending' AND worker_started_at IS NULL;

COMMENT ON COLUMN public.clone_backends.queued_admin_password_enc IS 'Encrypted admin password held only while status=pending; cleared once the worker seeds the admin user.';
COMMENT ON COLUMN public.clone_backends.worker_started_at IS 'Set atomically when a background worker claims this pending row.';