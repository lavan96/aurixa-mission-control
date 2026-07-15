
CREATE TABLE public.handoff_audit_shippers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handoff_id UUID NOT NULL REFERENCES public.clone_handoffs(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  endpoint_url TEXT NOT NULL,
  hmac_secret TEXT NOT NULL,
  filter JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_shipped_at TIMESTAMPTZ,
  last_event_at TIMESTAMPTZ,
  total_shipped BIGINT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (handoff_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.handoff_audit_shippers TO authenticated;
GRANT ALL ON public.handoff_audit_shippers TO service_role;

ALTER TABLE public.handoff_audit_shippers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage audit shippers" ON public.handoff_audit_shippers
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE TRIGGER update_handoff_audit_shippers_updated_at
  BEFORE UPDATE ON public.handoff_audit_shippers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.handoff_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handoff_id UUID NOT NULL REFERENCES public.clone_handoffs(id) ON DELETE CASCADE,
  source_event_id TEXT NOT NULL,
  source_project_ref TEXT,
  source_table TEXT,
  action TEXT,
  actor TEXT,
  occurred_at TIMESTAMPTZ,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (handoff_id, source_event_id)
);

CREATE INDEX handoff_audit_events_handoff_received_idx
  ON public.handoff_audit_events (handoff_id, received_at DESC);

GRANT SELECT ON public.handoff_audit_events TO authenticated;
GRANT ALL ON public.handoff_audit_events TO service_role;

ALTER TABLE public.handoff_audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read audit events" ON public.handoff_audit_events
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));
