-- Seed the operator-assigned billing/tracking identity for the PRIME tenant.
--
-- The clone provisioning form captures billing_user_id for clones, but the
-- prime repo (NPC Property Dashboard) is not a clone — its tenant is the
-- auto-provisioned `prime:<project_ref>` row with clone_id NULL, so nothing
-- ever assigns it a tracking id. Without one:
--   • Stripe checkout metadata carries billing_user_id = '' for prime
--     purchases (payments don't join the shared key),
--   • token reserve echoes null, so the prime's token_usage_history rows
--     carry a null billing_user_id, and
--   • there is no stable ?uid= fallback link for the prime dashboard.
--
-- 'npc-prime' is the assigned id; change it here AND in the prime repo's
-- pricing-link fallback (VITE_AURIXA_BILLING_UID) if you ever rename it.
-- Guarded so an operator-set value is never overwritten, and idempotent.

UPDATE public.tenants
   SET billing_user_id = 'npc-prime'
 WHERE external_ref = 'prime:dduzbchuswwbefdunfct'
   AND billing_user_id IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.tenants t2 WHERE t2.billing_user_id = 'npc-prime'
   );

-- Audit: warn if the prime tenant is still unassigned after this migration
-- (external_ref mismatch or the uid already taken by another row).
DO $$
DECLARE r RECORD;
BEGIN
  SELECT id, billing_user_id INTO r
    FROM public.tenants WHERE external_ref = 'prime:dduzbchuswwbefdunfct';
  IF NOT FOUND THEN
    RAISE WARNING 'Prime tenant (prime:dduzbchuswwbefdunfct) not found — it is auto-provisioned on first token/handoff call from the prime repo.';
  ELSIF r.billing_user_id IS NULL THEN
    RAISE WARNING 'Prime tenant still has NULL billing_user_id — is ''npc-prime'' already assigned to another tenant?';
  END IF;
END $$;
