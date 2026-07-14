-- Issue #7: make provision-time cascade execution durable via pg_cron drain
-- instead of a fire-and-forget worker call.

ALTER TABLE public.cascade_events
  ADD COLUMN IF NOT EXISTS worker_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS worker_finished_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_cascade_events_drain
  ON public.cascade_events (status, worker_started_at)
  WHERE status = 'pending' AND requires_approval = false;

DO $$
DECLARE
  v_secret text;
  v_headers text;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'cron_secret'
  LIMIT 1;

  IF v_secret IS NULL THEN
    RAISE NOTICE 'Vault entry cron_secret not found; skipping cascade-drain schedule.';
    RETURN;
  END IF;

  v_headers := jsonb_build_object(
    'Content-Type','application/json',
    'Authorization','Bearer ' || v_secret
  )::text;

  PERFORM cron.unschedule('cascade-drain-1min')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='cascade-drain-1min');

  PERFORM cron.schedule(
    'cascade-drain-1min', '* * * * *',
    format($f$SELECT net.http_post(
      url:='https://aurixa-mission-control.lovable.app/hooks/cascade-drain',
      headers:=%L::jsonb, body:='{}'::jsonb)$f$, v_headers)
  );
END $$;
