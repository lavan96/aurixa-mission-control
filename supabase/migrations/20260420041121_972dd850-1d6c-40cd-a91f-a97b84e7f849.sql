-- Enums
CREATE TYPE public.cascade_schedule_kind AS ENUM ('fleet_cascade', 'module_sync');
CREATE TYPE public.drift_severity AS ENUM ('low', 'medium', 'high');

-- cascade_schedules
CREATE TABLE public.cascade_schedules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  kind public.cascade_schedule_kind NOT NULL,
  cron_expression TEXT NOT NULL,
  mode public.cascade_mode NOT NULL DEFAULT 'pr',
  scope_filter JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  last_cascade_event_id UUID REFERENCES public.cascade_events(id) ON DELETE SET NULL,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.cascade_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators can read cascade_schedules"
  ON public.cascade_schedules FOR SELECT TO authenticated
  USING (public.is_operator(auth.uid()));

CREATE POLICY "Operators can write cascade_schedules"
  ON public.cascade_schedules FOR ALL TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));

CREATE TRIGGER update_cascade_schedules_updated_at
  BEFORE UPDATE ON public.cascade_schedules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_cascade_schedules_enabled ON public.cascade_schedules(enabled, next_run_at);

-- clone_drift_policies
CREATE TABLE public.clone_drift_policies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  clone_id UUID NOT NULL UNIQUE REFERENCES public.clones(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  auto_apply_severity public.drift_severity NOT NULL DEFAULT 'low',
  max_per_run INTEGER NOT NULL DEFAULT 3,
  cascade_mode public.cascade_mode NOT NULL DEFAULT 'pr',
  muted_kinds TEXT[] NOT NULL DEFAULT '{}'::text[],
  last_applied_at TIMESTAMPTZ,
  last_applied_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.clone_drift_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators can read clone_drift_policies"
  ON public.clone_drift_policies FOR SELECT TO authenticated
  USING (public.is_operator(auth.uid()));

CREATE POLICY "Operators can write clone_drift_policies"
  ON public.clone_drift_policies FOR ALL TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));

CREATE TRIGGER update_clone_drift_policies_updated_at
  BEFORE UPDATE ON public.clone_drift_policies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_clone_drift_policies_enabled ON public.clone_drift_policies(enabled);