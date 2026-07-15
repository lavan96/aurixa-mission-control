
CREATE TABLE public.handoff_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handoff_id UUID NOT NULL REFERENCES public.clone_handoffs(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  terms_version TEXT NOT NULL,
  terms_hash TEXT NOT NULL,
  terms_body TEXT,
  region_allowlist TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  plan_allowlist TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  consumed_ip TEXT,
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_handoff_invites_handoff ON public.handoff_invites(handoff_id);
CREATE INDEX idx_handoff_invites_active ON public.handoff_invites(handoff_id) WHERE consumed_at IS NULL AND revoked_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.handoff_invites TO authenticated;
GRANT ALL ON public.handoff_invites TO service_role;

ALTER TABLE public.handoff_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage handoff invites"
  ON public.handoff_invites FOR ALL
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE TRIGGER trg_handoff_invites_updated_at
  BEFORE UPDATE ON public.handoff_invites
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
