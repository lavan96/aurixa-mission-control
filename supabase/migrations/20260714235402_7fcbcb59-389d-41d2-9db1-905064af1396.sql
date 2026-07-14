
-- Enum: handoff state machine
CREATE TYPE public.handoff_state AS ENUM (
  'draft',
  'dry_run_ready',
  'awaiting_client_consent',
  'snapshot_pending',
  'snapshot_ready',
  'twin_provisioning',
  'twin_ready',
  'data_syncing',
  'cutover_scheduled',
  'cutover_in_progress',
  'complete',
  'rolled_back',
  'failed',
  'canceled'
);

CREATE TYPE public.handoff_path AS ENUM ('rebuild_twin', 'enterprise_transfer');

-- ─── client_supabase_accounts (E3) ─────────────────────────────────
CREATE TABLE public.client_supabase_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clone_id UUID REFERENCES public.clones(id) ON DELETE SET NULL,
  owner_email TEXT NOT NULL,
  owner_name TEXT,
  org_slug TEXT,
  org_id TEXT,
  pat_ciphertext BYTEA,
  pat_nonce BYTEA,
  pat_last4 TEXT,
  plan_tier TEXT,
  region_allowed TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  verified_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_client_supabase_accounts_clone ON public.client_supabase_accounts(clone_id);
CREATE INDEX idx_client_supabase_accounts_email ON public.client_supabase_accounts(owner_email);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_supabase_accounts TO authenticated;
GRANT ALL ON public.client_supabase_accounts TO service_role;
ALTER TABLE public.client_supabase_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage client supabase accounts"
  ON public.client_supabase_accounts FOR ALL
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- ─── handoff_region_plan_policies (E6) ────────────────────────────
CREATE TABLE public.handoff_region_plan_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  allowed_regions TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  allowed_plans TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  min_plan TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.handoff_region_plan_policies TO authenticated;
GRANT ALL ON public.handoff_region_plan_policies TO service_role;
ALTER TABLE public.handoff_region_plan_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage handoff region plan policies"
  ON public.handoff_region_plan_policies FOR ALL
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- ─── clone_handoffs (E1) ───────────────────────────────────────────
CREATE TABLE public.clone_handoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clone_id UUID NOT NULL REFERENCES public.clones(id) ON DELETE CASCADE,
  backend_id UUID REFERENCES public.clone_backends(id) ON DELETE SET NULL,
  client_account_id UUID REFERENCES public.client_supabase_accounts(id) ON DELETE SET NULL,
  policy_id UUID REFERENCES public.handoff_region_plan_policies(id) ON DELETE SET NULL,
  path public.handoff_path NOT NULL DEFAULT 'rebuild_twin',
  state public.handoff_state NOT NULL DEFAULT 'draft',
  target_region TEXT,
  target_plan_tier TEXT,
  target_project_ref TEXT,
  target_project_url TEXT,
  consent_signed_at TIMESTAMPTZ,
  consent_terms_version TEXT,
  initiated_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  rollback_snapshot_id UUID,
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_clone_handoffs_clone ON public.clone_handoffs(clone_id);
CREATE INDEX idx_clone_handoffs_state ON public.clone_handoffs(state);
CREATE UNIQUE INDEX idx_clone_handoffs_active_per_clone
  ON public.clone_handoffs(clone_id)
  WHERE state NOT IN ('complete', 'rolled_back', 'failed', 'canceled');
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clone_handoffs TO authenticated;
GRANT ALL ON public.clone_handoffs TO service_role;
ALTER TABLE public.clone_handoffs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage clone handoffs"
  ON public.clone_handoffs FOR ALL
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- ─── handoff_events ────────────────────────────────────────────────
CREATE TABLE public.handoff_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handoff_id UUID NOT NULL REFERENCES public.clone_handoffs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_handoff_events_handoff ON public.handoff_events(handoff_id, created_at DESC);
GRANT SELECT, INSERT ON public.handoff_events TO authenticated;
GRANT ALL ON public.handoff_events TO service_role;
ALTER TABLE public.handoff_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read handoff events"
  ON public.handoff_events FOR SELECT USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins insert handoff events"
  ON public.handoff_events FOR INSERT WITH CHECK (public.is_admin(auth.uid()));

-- ─── handoff_snapshots (E4) ────────────────────────────────────────
CREATE TABLE public.handoff_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handoff_id UUID NOT NULL REFERENCES public.clone_handoffs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('pitr_pin','pg_dump','storage_export','auth_export')),
  storage_path TEXT,
  size_bytes BIGINT,
  sha256 TEXT,
  retention_expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','failed','expired','deleted')),
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_handoff_snapshots_handoff ON public.handoff_snapshots(handoff_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.handoff_snapshots TO authenticated;
GRANT ALL ON public.handoff_snapshots TO service_role;
ALTER TABLE public.handoff_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage handoff snapshots"
  ON public.handoff_snapshots FOR ALL
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- ─── handoff_parity_reports (E2) ──────────────────────────────────
CREATE TABLE public.handoff_parity_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handoff_id UUID NOT NULL REFERENCES public.clone_handoffs(id) ON DELETE CASCADE,
  prime_ref TEXT,
  target_ref TEXT,
  risk_level TEXT NOT NULL DEFAULT 'unknown' CHECK (risk_level IN ('unknown','low','medium','high','blocking')),
  tables_diff JSONB NOT NULL DEFAULT '{}'::jsonb,
  policies_diff JSONB NOT NULL DEFAULT '{}'::jsonb,
  functions_diff JSONB NOT NULL DEFAULT '{}'::jsonb,
  buckets_diff JSONB NOT NULL DEFAULT '{}'::jsonb,
  cron_diff JSONB NOT NULL DEFAULT '{}'::jsonb,
  edge_functions_diff JSONB NOT NULL DEFAULT '{}'::jsonb,
  secrets_diff JSONB NOT NULL DEFAULT '{}'::jsonb,
  auth_diff JSONB NOT NULL DEFAULT '{}'::jsonb,
  extensions_diff JSONB NOT NULL DEFAULT '{}'::jsonb,
  blocking_issues JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_handoff_parity_handoff ON public.handoff_parity_reports(handoff_id, generated_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.handoff_parity_reports TO authenticated;
GRANT ALL ON public.handoff_parity_reports TO service_role;
ALTER TABLE public.handoff_parity_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage handoff parity reports"
  ON public.handoff_parity_reports FOR ALL
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- ─── handoff_contracts (E7) ───────────────────────────────────────
CREATE TABLE public.handoff_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handoff_id UUID NOT NULL REFERENCES public.clone_handoffs(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  pdf_storage_path TEXT,
  terms_hash TEXT NOT NULL,
  signed_by_name TEXT,
  signed_by_email TEXT,
  signed_at TIMESTAMPTZ,
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_handoff_contracts_handoff ON public.handoff_contracts(handoff_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.handoff_contracts TO authenticated;
GRANT ALL ON public.handoff_contracts TO service_role;
ALTER TABLE public.handoff_contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage handoff contracts"
  ON public.handoff_contracts FOR ALL
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- ─── handoff_secret_rotations (E5) ────────────────────────────────
CREATE TABLE public.handoff_secret_rotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handoff_id UUID NOT NULL REFERENCES public.clone_handoffs(id) ON DELETE CASCADE,
  target TEXT NOT NULL CHECK (target IN ('clone_repo','cloudflare','stripe_endpoint','github_webhook','webhook_consumer','edge_function_env','other')),
  key_ref TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','rotating','rotated','failed','rolled_back','skipped')),
  rotated_at TIMESTAMPTZ,
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_handoff_secret_rotations_handoff ON public.handoff_secret_rotations(handoff_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.handoff_secret_rotations TO authenticated;
GRANT ALL ON public.handoff_secret_rotations TO service_role;
ALTER TABLE public.handoff_secret_rotations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage handoff secret rotations"
  ON public.handoff_secret_rotations FOR ALL
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- ─── handoff_cost_exports (E8) ────────────────────────────────────
CREATE TABLE public.handoff_cost_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handoff_id UUID NOT NULL REFERENCES public.clone_handoffs(id) ON DELETE CASCADE,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  storage_path TEXT,
  rows_included INTEGER,
  total_tokens BIGINT,
  total_cents BIGINT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','failed')),
  error TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_handoff_cost_exports_handoff ON public.handoff_cost_exports(handoff_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.handoff_cost_exports TO authenticated;
GRANT ALL ON public.handoff_cost_exports TO service_role;
ALTER TABLE public.handoff_cost_exports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage handoff cost exports"
  ON public.handoff_cost_exports FOR ALL
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- Rollback snapshot FK (added after both tables exist)
ALTER TABLE public.clone_handoffs
  ADD CONSTRAINT clone_handoffs_rollback_snapshot_fk
  FOREIGN KEY (rollback_snapshot_id) REFERENCES public.handoff_snapshots(id) ON DELETE SET NULL;

-- updated_at triggers
CREATE TRIGGER trg_client_supabase_accounts_updated
  BEFORE UPDATE ON public.client_supabase_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_handoff_region_plan_policies_updated
  BEFORE UPDATE ON public.handoff_region_plan_policies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_clone_handoffs_updated
  BEFORE UPDATE ON public.clone_handoffs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_handoff_secret_rotations_updated
  BEFORE UPDATE ON public.handoff_secret_rotations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
