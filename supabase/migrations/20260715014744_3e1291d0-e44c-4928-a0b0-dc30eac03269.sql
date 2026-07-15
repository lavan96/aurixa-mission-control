
CREATE TABLE public.handoff_storage_replications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  handoff_id UUID NOT NULL REFERENCES public.clone_handoffs(id) ON DELETE CASCADE,
  bucket_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  cursor_prefix TEXT,
  cursor_offset INTEGER NOT NULL DEFAULT 0,
  objects_scanned INTEGER NOT NULL DEFAULT 0,
  objects_copied INTEGER NOT NULL DEFAULT 0,
  objects_skipped INTEGER NOT NULL DEFAULT 0,
  objects_failed INTEGER NOT NULL DEFAULT 0,
  bytes_copied BIGINT NOT NULL DEFAULT 0,
  last_error TEXT,
  last_run_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (handoff_id, bucket_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.handoff_storage_replications TO authenticated;
GRANT ALL ON public.handoff_storage_replications TO service_role;

ALTER TABLE public.handoff_storage_replications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage handoff storage replications"
  ON public.handoff_storage_replications
  FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE INDEX idx_handoff_storage_replications_handoff
  ON public.handoff_storage_replications (handoff_id);

CREATE TRIGGER trg_handoff_storage_replications_updated_at
  BEFORE UPDATE ON public.handoff_storage_replications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
