-- Phase 7: Cloudflare integration
CREATE TABLE public.cloudflare_accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id TEXT NOT NULL,
  account_name TEXT,
  email TEXT,
  token_secret_name TEXT NOT NULL DEFAULT 'CLOUDFLARE_API_TOKEN',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(account_id)
);

CREATE TABLE public.cloudflare_clone_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  clone_id UUID NOT NULL UNIQUE,
  account_id TEXT NOT NULL,
  zone_id TEXT NOT NULL,
  zone_name TEXT NOT NULL,
  plan TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  security_level TEXT,
  bot_fight_mode BOOLEAN NOT NULL DEFAULT false,
  rate_limit_rps INTEGER,
  waf_preset TEXT,
  posture JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.cloudflare_audit (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  clone_id UUID,
  zone_id TEXT,
  action TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  success BOOLEAN NOT NULL DEFAULT true,
  error_message TEXT,
  actor_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cf_audit_clone ON public.cloudflare_audit(clone_id, created_at DESC);
CREATE INDEX idx_cf_clone_config_zone ON public.cloudflare_clone_config(zone_id);

ALTER TABLE public.cloudflare_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cloudflare_clone_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cloudflare_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators read cf accounts" ON public.cloudflare_accounts FOR SELECT TO authenticated USING (is_operator(auth.uid()));
CREATE POLICY "Admins write cf accounts" ON public.cloudflare_accounts FOR ALL TO authenticated USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

CREATE POLICY "Operators read cf clone cfg" ON public.cloudflare_clone_config FOR SELECT TO authenticated USING (is_operator(auth.uid()));
CREATE POLICY "Operators write cf clone cfg" ON public.cloudflare_clone_config FOR ALL TO authenticated USING (is_operator(auth.uid())) WITH CHECK (is_operator(auth.uid()));

CREATE POLICY "Operators read cf audit" ON public.cloudflare_audit FOR SELECT TO authenticated USING (is_operator(auth.uid()));
CREATE POLICY "Operators insert cf audit" ON public.cloudflare_audit FOR INSERT TO authenticated WITH CHECK (is_operator(auth.uid()));

CREATE TRIGGER trg_cf_accounts_updated BEFORE UPDATE ON public.cloudflare_accounts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_cf_clone_cfg_updated BEFORE UPDATE ON public.cloudflare_clone_config FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Phase 9: Observability supporting tables
CREATE TABLE public.ai_usage_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  feature TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  cost_estimate_usd NUMERIC(10,6),
  user_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_usage_created ON public.ai_usage_log(created_at DESC);
CREATE INDEX idx_ai_usage_feature ON public.ai_usage_log(feature, created_at DESC);
ALTER TABLE public.ai_usage_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators read ai usage" ON public.ai_usage_log FOR SELECT TO authenticated USING (is_operator(auth.uid()));
CREATE POLICY "Operators insert ai usage" ON public.ai_usage_log FOR INSERT TO authenticated WITH CHECK (is_operator(auth.uid()));

CREATE TABLE public.push_delivery_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  notification_id UUID,
  subscription_id UUID,
  user_id UUID,
  success BOOLEAN NOT NULL,
  status_code INTEGER,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_push_delivery_created ON public.push_delivery_log(created_at DESC);
ALTER TABLE public.push_delivery_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators read push delivery" ON public.push_delivery_log FOR SELECT TO authenticated USING (is_operator(auth.uid()));
CREATE POLICY "Operators insert push delivery" ON public.push_delivery_log FOR INSERT TO authenticated WITH CHECK (is_operator(auth.uid()));

-- Phase 8: Fleet digests
CREATE TABLE public.fleet_digests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  summary_markdown TEXT NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_by_model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_fleet_digests_period ON public.fleet_digests(period_end DESC);
ALTER TABLE public.fleet_digests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators read digests" ON public.fleet_digests FOR SELECT TO authenticated USING (is_operator(auth.uid()));
CREATE POLICY "Operators insert digests" ON public.fleet_digests FOR INSERT TO authenticated WITH CHECK (is_operator(auth.uid()));

-- Phase 10: User preferences (saved filters, shortcuts)
CREATE TABLE public.user_preferences (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  scope TEXT NOT NULL,
  name TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, scope, name)
);
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own prefs" ON public.user_preferences FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_user_prefs_updated BEFORE UPDATE ON public.user_preferences FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Phase 11: Module library deprecation + notification digest mode
ALTER TABLE public.module_library ADD COLUMN IF NOT EXISTS deprecated_at TIMESTAMPTZ;
ALTER TABLE public.module_library ADD COLUMN IF NOT EXISTS deprecated_reason TEXT;
ALTER TABLE public.module_library ADD COLUMN IF NOT EXISTS replacement_slug TEXT;

ALTER TABLE public.notification_preferences ADD COLUMN IF NOT EXISTS digest_mode TEXT NOT NULL DEFAULT 'realtime';
-- digest_mode: 'realtime' | 'hourly' | 'daily'