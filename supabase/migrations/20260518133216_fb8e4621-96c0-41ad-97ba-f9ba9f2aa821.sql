
REVOKE EXECUTE ON FUNCTION public.recompute_token_balance(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reserve_tokens(UUID, UUID, TEXT, INTEGER, TEXT, INTEGER, JSONB) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.commit_tokens(UUID, INTEGER, JSONB) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_token_reservation(UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.refund_job(UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.grant_tokens(UUID, INTEGER, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.apply_topup(UUID, UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.tg_ledger_recompute_balance() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.reserve_tokens(UUID, UUID, TEXT, INTEGER, TEXT, INTEGER, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.commit_tokens(UUID, INTEGER, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_token_reservation(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refund_job(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.grant_tokens(UUID, INTEGER, TEXT, TIMESTAMPTZ) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_topup(UUID, UUID, TEXT) TO authenticated, service_role;
