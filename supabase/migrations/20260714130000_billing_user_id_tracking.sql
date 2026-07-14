-- Operator-assigned billing/tracking identity for storefront checkout.
--
-- Admins/operators set a `billing_user_id` (and optional Stripe customer id)
-- when provisioning a clone in Mission Control. That id:
--   • is the `?uid=` key the Aurixa Systems pricing page checks out against
--     (alongside the existing single-use `?h=` handoff), and
--   • is stamped into every Stripe checkout session's metadata + the purchases
--     ledger, so payments and the exact products bought are attributable to the
--     specific tenant/clone (and, downstream, to that user's token usage).

ALTER TABLE public.clones  ADD COLUMN IF NOT EXISTS billing_user_id text;
ALTER TABLE public.clones  ADD COLUMN IF NOT EXISTS billing_stripe_customer_id text;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS billing_user_id text;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS billing_stripe_customer_id text;

-- A billing_user_id resolves to exactly one clone / one tenant so `?uid=`
-- checkout is unambiguous. Partial indexes ignore the (many) null rows.
CREATE UNIQUE INDEX IF NOT EXISTS clones_billing_user_id_uidx
  ON public.clones (billing_user_id)  WHERE billing_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tenants_billing_user_id_uidx
  ON public.tenants (billing_user_id) WHERE billing_user_id IS NOT NULL;

COMMENT ON COLUMN public.clones.billing_user_id IS
  'Operator-assigned tracking user id. The ?uid= key the storefront pricing page checks out against; copied onto the clone''s tenant on first provision.';
COMMENT ON COLUMN public.tenants.billing_user_id IS
  'Tracking user id copied from the owning clone. Stamped into Stripe session metadata + the purchases ledger so payments/products attribute to this tenant.';
