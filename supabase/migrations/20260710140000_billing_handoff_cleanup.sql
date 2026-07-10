-- User-attributed pricing workflow — Phase 2 housekeeping
-- (docs/user-tracking-pricing-workflow-plan.md §4 Phase 2, §7 "Abandoned rows").
--
-- Handoffs are minted freely (every attributed packs fetch can create one),
-- so expired, never-consumed tokens must be swept. Checkout sessions that
-- never completed get marked 'abandoned' after 24 h. Invoked by the existing
-- 5-minute expire-reservations cron hook.

CREATE OR REPLACE FUNCTION public.cleanup_billing_attribution()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _handoffs INTEGER; _abandoned INTEGER;
BEGIN
  -- Expired, never-consumed handoffs after a 24 h grace period. Handoffs
  -- referenced by a purchases row are kept — they are the attribution trail.
  DELETE FROM public.billing_handoffs h
   WHERE h.consumed_at IS NULL
     AND h.expires_at < now() - interval '24 hours'
     AND NOT EXISTS (SELECT 1 FROM public.purchases p WHERE p.handoff_id = h.id);
  GET DIAGNOSTICS _handoffs = ROW_COUNT;

  -- Checkout sessions that never reached the webhook within 24 h. A late
  -- webhook still wins: fulfilment upserts the row back to 'completed'.
  UPDATE public.purchases
     SET status = 'abandoned'
   WHERE status = 'initiated'
     AND created_at < now() - interval '24 hours';
  GET DIAGNOSTICS _abandoned = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'handoffs_deleted', _handoffs,
    'purchases_abandoned', _abandoned
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_billing_attribution() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.cleanup_billing_attribution() TO service_role;
