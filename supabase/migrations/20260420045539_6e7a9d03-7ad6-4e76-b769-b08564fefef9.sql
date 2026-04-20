-- Phase 5 follow-up: cache per-clone health probes so /health is instant after first probe.
CREATE TABLE public.clone_health_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  clone_id UUID NOT NULL UNIQUE REFERENCES public.clones(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  probed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.clone_health_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators can read clone_health_snapshots"
ON public.clone_health_snapshots FOR SELECT
TO authenticated
USING (public.is_operator(auth.uid()));

CREATE POLICY "Operators can write clone_health_snapshots"
ON public.clone_health_snapshots FOR ALL
TO authenticated
USING (public.is_operator(auth.uid()))
WITH CHECK (public.is_operator(auth.uid()));

CREATE TRIGGER update_clone_health_snapshots_updated_at
BEFORE UPDATE ON public.clone_health_snapshots
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_clone_health_snapshots_probed_at ON public.clone_health_snapshots(probed_at DESC);