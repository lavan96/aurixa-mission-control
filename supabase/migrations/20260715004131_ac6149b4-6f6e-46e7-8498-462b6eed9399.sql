
DO $$ BEGIN
  CREATE TYPE public.clone_stripe_mode AS ENUM ('platform','own_account','connect');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.clone_stripe_status AS ENUM ('pending','active','rotated','revoked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.clone_stripe_configs (
  clone_id uuid PRIMARY KEY REFERENCES public.clones(id) ON DELETE CASCADE,
  mode public.clone_stripe_mode NOT NULL DEFAULT 'platform',
  stripe_account_id text,
  webhook_secret_ciphertext text,
  webhook_secret_last4 text,
  forward_url text,
  status public.clone_stripe_status NOT NULL DEFAULT 'pending',
  activated_at timestamptz,
  rotated_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.clone_stripe_configs TO authenticated;
GRANT ALL ON public.clone_stripe_configs TO service_role;

ALTER TABLE public.clone_stripe_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage clone stripe configs" ON public.clone_stripe_configs;
CREATE POLICY "Admins manage clone stripe configs"
  ON public.clone_stripe_configs
  FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

DROP TRIGGER IF EXISTS update_clone_stripe_configs_updated_at ON public.clone_stripe_configs;
CREATE TRIGGER update_clone_stripe_configs_updated_at
  BEFORE UPDATE ON public.clone_stripe_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Attribute stripe events to their originating clone / connected account when
-- events come in via the per-clone webhook route. Nullable to preserve
-- platform-wide events; existing idempotency on stripe_event_id is unchanged.
ALTER TABLE public.stripe_events
  ADD COLUMN IF NOT EXISTS clone_id uuid REFERENCES public.clones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stripe_account_id text;

CREATE INDEX IF NOT EXISTS idx_stripe_events_clone_id ON public.stripe_events(clone_id);
