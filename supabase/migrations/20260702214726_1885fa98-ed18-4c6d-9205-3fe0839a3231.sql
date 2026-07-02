
-- =========================================================
-- Phase 1: Edge Security Foundations
-- =========================================================

-- 1) Providers catalog
CREATE TABLE public.edge_providers (
  slug TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'mocked' CHECK (status IN ('live','mocked','disabled')),
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.edge_providers TO authenticated;
GRANT ALL ON public.edge_providers TO service_role;
ALTER TABLE public.edge_providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "edge_providers read all authed" ON public.edge_providers
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "edge_providers admin write" ON public.edge_providers
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
CREATE TRIGGER trg_edge_providers_updated
  BEFORE UPDATE ON public.edge_providers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Posture presets
CREATE TABLE public.edge_posture_presets (
  slug TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.edge_posture_presets TO authenticated;
GRANT ALL ON public.edge_posture_presets TO service_role;
ALTER TABLE public.edge_posture_presets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "edge_presets read all authed" ON public.edge_posture_presets
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "edge_presets admin write" ON public.edge_posture_presets
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
CREATE TRIGGER trg_edge_presets_updated
  BEFORE UPDATE ON public.edge_posture_presets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) Per-clone edge configuration (multi-provider)
CREATE TABLE public.clone_edge_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clone_id UUID NOT NULL REFERENCES public.clones(id) ON DELETE CASCADE,
  provider_slug TEXT NOT NULL REFERENCES public.edge_providers(slug),
  account_ref TEXT,
  external_ref TEXT,
  hostname TEXT,
  posture_preset TEXT REFERENCES public.edge_posture_presets(slug),
  security_level TEXT,
  bot_fight BOOLEAN NOT NULL DEFAULT false,
  rate_limit_rps INT,
  waf_preset TEXT,
  custom_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','waitlisted','pending_ns','verifying','active','drifted','failed','detached')),
  status_detail TEXT,
  drift JSONB,
  last_synced_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clone_id, provider_slug)
);
CREATE INDEX idx_clone_edge_config_clone ON public.clone_edge_config(clone_id);
CREATE INDEX idx_clone_edge_config_provider ON public.clone_edge_config(provider_slug);
CREATE INDEX idx_clone_edge_config_status ON public.clone_edge_config(status);
GRANT SELECT ON public.clone_edge_config TO authenticated;
GRANT ALL ON public.clone_edge_config TO service_role;
ALTER TABLE public.clone_edge_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "edge_config operator read" ON public.clone_edge_config
  FOR SELECT TO authenticated USING (public.is_operator(auth.uid()));
CREATE POLICY "edge_config admin write" ON public.clone_edge_config
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
CREATE TRIGGER trg_clone_edge_config_updated
  BEFORE UPDATE ON public.clone_edge_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4) Provisioning job queue
CREATE TABLE public.edge_provisioning_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clone_id UUID NOT NULL REFERENCES public.clones(id) ON DELETE CASCADE,
  provider_slug TEXT NOT NULL REFERENCES public.edge_providers(slug),
  action TEXT NOT NULL CHECK (action IN ('attach','apply_posture','sync','detach')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','succeeded','failed','retry','canceled')),
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  result JSONB,
  error TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (clone_id, provider_slug, action, payload_hash)
);
CREATE INDEX idx_edge_jobs_status_next ON public.edge_provisioning_jobs(status, next_attempt_at);
CREATE INDEX idx_edge_jobs_clone ON public.edge_provisioning_jobs(clone_id);
GRANT SELECT ON public.edge_provisioning_jobs TO authenticated;
GRANT ALL ON public.edge_provisioning_jobs TO service_role;
ALTER TABLE public.edge_provisioning_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "edge_jobs operator read" ON public.edge_provisioning_jobs
  FOR SELECT TO authenticated USING (public.is_operator(auth.uid()));
CREATE POLICY "edge_jobs admin write" ON public.edge_provisioning_jobs
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
CREATE TRIGGER trg_edge_jobs_updated
  BEFORE UPDATE ON public.edge_provisioning_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5) Unified audit log
CREATE TABLE public.edge_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clone_id UUID REFERENCES public.clones(id) ON DELETE SET NULL,
  provider_slug TEXT NOT NULL,
  external_ref TEXT,
  action TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  success BOOLEAN NOT NULL,
  error_message TEXT,
  actor_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_edge_audit_clone ON public.edge_audit(clone_id, created_at DESC);
CREATE INDEX idx_edge_audit_provider ON public.edge_audit(provider_slug, created_at DESC);
GRANT SELECT ON public.edge_audit TO authenticated;
GRANT ALL ON public.edge_audit TO service_role;
ALTER TABLE public.edge_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "edge_audit operator read" ON public.edge_audit
  FOR SELECT TO authenticated USING (public.is_operator(auth.uid()));
CREATE POLICY "edge_audit admin write" ON public.edge_audit
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- 6) Seed providers
INSERT INTO public.edge_providers (slug, display_name, status, capabilities, sort_order) VALUES
  ('cloudflare', 'Cloudflare',      'live',   '{"dns":true,"waf":true,"rate_limit":true,"bot":true,"analytics":true}'::jsonb, 10),
  ('aws',        'AWS CloudFront',  'mocked', '{"dns":false,"waf":true,"rate_limit":true,"bot":false,"analytics":true}'::jsonb, 20),
  ('azure',      'Azure Front Door','mocked', '{"dns":false,"waf":true,"rate_limit":true,"bot":false,"analytics":true}'::jsonb, 30);

-- 7) Seed presets
INSERT INTO public.edge_posture_presets (slug, display_name, description, settings, is_default) VALUES
  ('lenient',      'Lenient',       'Minimal interference; best for internal tools.',
   '{"security_level":"low","bot_fight":false,"rate_limit_rps":0,"waf_preset":"lenient"}'::jsonb, false),
  ('balanced',     'Balanced',      'Default protection for production clones.',
   '{"security_level":"medium","bot_fight":true,"rate_limit_rps":50,"waf_preset":"balanced"}'::jsonb, true),
  ('strict',       'Strict',        'Aggressive filtering for high-risk deployments.',
   '{"security_level":"high","bot_fight":true,"rate_limit_rps":20,"waf_preset":"strict"}'::jsonb, false),
  ('under_attack', 'Under Attack',  'Emergency posture during active incidents.',
   '{"security_level":"under_attack","bot_fight":true,"rate_limit_rps":10,"waf_preset":"strict"}'::jsonb, false);

-- 8) Back-compat: copy existing cloudflare_clone_config rows
INSERT INTO public.clone_edge_config (
  clone_id, provider_slug, account_ref, external_ref, hostname,
  security_level, bot_fight, rate_limit_rps, waf_preset, status, last_synced_at
)
SELECT
  c.clone_id, 'cloudflare', c.account_id, c.zone_id, c.zone_name,
  c.security_level, COALESCE(c.bot_fight_mode, false), c.rate_limit_rps, c.waf_preset,
  CASE WHEN c.status = 'active' THEN 'active' ELSE 'pending' END,
  c.last_synced_at
FROM public.cloudflare_clone_config c
ON CONFLICT (clone_id, provider_slug) DO NOTHING;
