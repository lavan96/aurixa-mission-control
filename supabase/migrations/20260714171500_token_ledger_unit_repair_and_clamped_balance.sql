-- Token ledger unit repair + clamped balance recomputation.
--
-- Problem this fixes: between 2026-05-19 and 2026-07-14 the prime clone's
-- report generators committed RAW LLM TOKEN counts (~9,600–14,400 per report)
-- instead of billing credits (~10–15 per report). Those debits drove tenant
-- ledgers tens of millions of tokens negative. recompute_token_balance() nets
-- the whole lifetime ledger, so every subsequent grant/gift/top-up is
-- swallowed by that debt and `available` clamps to 0 — operator gifts appear
-- to "succeed" but never show up on clone dashboards.
--
-- Two-part fix:
--   1. Rescale the bug-era debits back into billing credits (÷1000, the exact
--      inflation factor of the bug), stamping the original value into
--      metadata for auditability. Idempotent via the metadata marker.
--   2. Replace recompute_token_balance() with a chronological replay that
--      clamps the running balance at zero. Spend that was allowed while the
--      balance was already empty (non-'block' overage policies let reserves
--      through) no longer creates hidden debt that consumes future grants —
--      which is what made the gift invisible.

-- ── 1. Rescale bug-era debits ────────────────────────────────────────────────
-- Only 'debit' rows need rescaling: reserve/release pairs always cancel out
-- (commit_tokens releases the exact reserved amount). No legitimate pre-fix
-- debit reaches 1,000 credits (largest observed real cost is 15 credits; the
-- generators shipped the corrected units on 2026-07-14), so magnitude plus the
-- cutoff cleanly separates bug rows from real ones.
UPDATE public.token_ledger
SET metadata = COALESCE(metadata, '{}'::jsonb)
      || jsonb_build_object(
           'unit_corrected', true,
           'original_tokens', tokens,
           'corrected_at', now()
         ),
    tokens = (SIGN(tokens) * CEIL(ABS(tokens) / 1000.0))::int
WHERE kind = 'debit'
  AND ABS(tokens) >= 1000
  AND created_at < TIMESTAMPTZ '2026-07-14 16:17:00+00'
  AND (metadata ->> 'unit_corrected') IS NULL;

-- Keep report_jobs.charged_tokens consistent with the repaired ledger so
-- per-job views don't show the inflated figures.
UPDATE public.report_jobs
SET charged_tokens = CEIL(charged_tokens / 1000.0)::int
WHERE charged_tokens >= 1000
  AND completed_at < TIMESTAMPTZ '2026-07-14 16:17:00+00';

-- ── 2. Chronological, zero-clamped balance recomputation ────────────────────
CREATE OR REPLACE FUNCTION public.recompute_token_balance(_tenant_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row RECORD;
  _running BIGINT := 0;
  _reserved INTEGER;
  _granted BIGINT := 0;
  _spent BIGINT := 0;
BEGIN
  -- Replay credits/debits in order, clamping at zero. A debit taken while the
  -- balance is empty (permitted under non-'block' overage policies) is not
  -- carried forward as debt against future grants.
  FOR _row IN
    SELECT kind, tokens
    FROM public.token_ledger
    WHERE tenant_id = _tenant_id
      AND (expires_at IS NULL OR expires_at > now())
      AND kind IN ('grant', 'topup', 'refund', 'adjustment', 'debit', 'expiry')
    ORDER BY created_at, id
  LOOP
    IF _row.kind IN ('grant', 'topup', 'refund', 'adjustment') THEN
      _running := GREATEST(0, _running + _row.tokens);
      IF _row.kind IN ('grant', 'topup') THEN
        _granted := _granted + _row.tokens;
      END IF;
    ELSE -- debit / expiry
      _running := GREATEST(0, _running - ABS(_row.tokens));
      IF _row.kind = 'debit' THEN
        _spent := _spent + ABS(_row.tokens);
      END IF;
    END IF;
  END LOOP;

  -- Reserved is the running balance of reserves not yet released or debited
  -- (unchanged from the previous definition).
  SELECT COALESCE(SUM(CASE
      WHEN kind = 'reserve' THEN ABS(tokens)
      WHEN kind = 'release' THEN -ABS(tokens)
      WHEN kind = 'debit' AND report_job_id IS NOT NULL THEN -ABS(tokens)
      ELSE 0
    END), 0)
  INTO _reserved
  FROM public.token_ledger
  WHERE tenant_id = _tenant_id
    AND (expires_at IS NULL OR expires_at > now());
  _reserved := GREATEST(0, _reserved);

  INSERT INTO public.token_balances (tenant_id, available, reserved, lifetime_granted, lifetime_spent, updated_at)
  VALUES (
    _tenant_id,
    GREATEST(0, LEAST(_running - _reserved, 2147483647))::int,
    _reserved,
    LEAST(_granted, 2147483647)::int,
    LEAST(_spent, 2147483647)::int,
    now()
  )
  ON CONFLICT (tenant_id) DO UPDATE
    SET available = EXCLUDED.available,
        reserved = EXCLUDED.reserved,
        lifetime_granted = EXCLUDED.lifetime_granted,
        lifetime_spent = EXCLUDED.lifetime_spent,
        updated_at = now();
END;
$$;

-- ── 3. Recompute every tenant's cached balance against the repaired ledger ──
-- (the ledger trigger only fires on INSERT, so the UPDATEs above need this).
DO $$
DECLARE _t UUID;
BEGIN
  FOR _t IN SELECT DISTINCT tenant_id FROM public.token_ledger LOOP
    PERFORM public.recompute_token_balance(_t);
  END LOOP;
END;
$$;
