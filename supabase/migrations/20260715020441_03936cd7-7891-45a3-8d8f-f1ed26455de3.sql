-- G20 — Post-handoff observability.
-- After ownership transfers, Mission Control loses row-level visibility into
-- the client backend. This migration stores per-handoff observability config
-- (how we stay in the loop) and an inbound telemetry table for beacons from
-- the client's backend.

CREATE TABLE public.handoff_observability_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handoff_id uuid NOT NULL REFERENCES public.clone_handoffs(id) ON DELETE CASCADE,
  clone_id uuid NOT NULL REFERENCES public.clones(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('pat_polling','health_beacons','shared_role','dropped')) DEFAULT 'health_beacons',
  poll_interval_seconds int NOT NULL DEFAULT 900,
  next_poll_at timestamptz,
  last_poll_at timestamptz,
  last_status text,
  last_error text,
  last_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (handoff_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.handoff_observability_configs TO authenticated;
GRANT ALL ON public.handoff_observability_configs TO service_role;
ALTER TABLE public.handoff_observability_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "obs_configs_admin" ON public.handoff_observability_configs
  FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE INDEX idx_obs_configs_next_poll ON public.handoff_observability_configs (next_poll_at)
  WHERE mode = 'pat_polling';

CREATE TRIGGER obs_configs_updated
  BEFORE UPDATE ON public.handoff_observability_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.clone_health_beacons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clone_id uuid NOT NULL REFERENCES public.clones(id) ON DELETE CASCADE,
  handoff_id uuid REFERENCES public.clone_handoffs(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('pat_poll','beacon','shared_role','manual')),
  reported_at timestamptz NOT NULL DEFAULT now(),
  project_ref text,
  project_status text,
  db_size_bytes bigint,
  active_connections int,
  api_p95_ms int,
  storage_used_bytes bigint,
  edge_invocations_24h int,
  error_count_24h int,
  severity text CHECK (severity IN ('ok','warn','critical')) DEFAULT 'ok',
  message text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.clone_health_beacons TO authenticated;
GRANT ALL ON public.clone_health_beacons TO service_role;
ALTER TABLE public.clone_health_beacons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "beacons_admin_read" ON public.clone_health_beacons
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "beacons_admin_write" ON public.clone_health_beacons
  FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE INDEX idx_beacons_clone_recent ON public.clone_health_beacons (clone_id, reported_at DESC);
CREATE INDEX idx_beacons_handoff_recent ON public.clone_health_beacons (handoff_id, reported_at DESC) WHERE handoff_id IS NOT NULL;
