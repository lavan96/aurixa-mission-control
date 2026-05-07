
-- Telemetry table for route-level error reports
CREATE TABLE public.route_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_path TEXT NOT NULL,
  message TEXT NOT NULL,
  stack TEXT,
  user_agent TEXT,
  user_id UUID,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_route_errors_path_time ON public.route_errors (route_path, created_at DESC);
CREATE INDEX idx_route_errors_created ON public.route_errors (created_at DESC);

ALTER TABLE public.route_errors ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can insert telemetry (own errors)
CREATE POLICY "Authenticated users can report route errors"
ON public.route_errors
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Operators can read for the dashboard
CREATE POLICY "Operators can view route errors"
ON public.route_errors
FOR SELECT
TO authenticated
USING (public.is_operator(auth.uid()));

-- Admins can purge
CREATE POLICY "Admins can delete route errors"
ON public.route_errors
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
