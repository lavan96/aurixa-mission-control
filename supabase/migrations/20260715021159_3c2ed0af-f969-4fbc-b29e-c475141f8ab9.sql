
CREATE TABLE public.handoff_billing_splits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  handoff_id UUID NOT NULL UNIQUE REFERENCES public.clone_handoffs(id) ON DELETE CASCADE,
  clone_id UUID NOT NULL REFERENCES public.clones(id) ON DELETE CASCADE,
  aurixa_stripe_customer_id TEXT,
  aurixa_stripe_subscription_id TEXT,
  aurixa_products_kept JSONB NOT NULL DEFAULT '[]'::jsonb,
  client_supabase_org_id TEXT,
  client_supabase_plan TEXT,
  client_billed_directly BOOLEAN NOT NULL DEFAULT false,
  disclosed_to_client_at TIMESTAMPTZ,
  decoupled_at TIMESTAMPTZ,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.handoff_billing_splits TO authenticated;
GRANT ALL ON public.handoff_billing_splits TO service_role;

ALTER TABLE public.handoff_billing_splits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage handoff billing splits"
  ON public.handoff_billing_splits FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE TRIGGER update_handoff_billing_splits_updated_at
  BEFORE UPDATE ON public.handoff_billing_splits
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_handoff_billing_splits_clone ON public.handoff_billing_splits(clone_id);
