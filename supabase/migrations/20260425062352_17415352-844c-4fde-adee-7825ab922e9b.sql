-- Phase 5: register pg_cron job for brand drift detection.
-- Pings the published /hooks/brand-drift endpoint every 30 min so brand
-- profile changes are surfaced as 'drifted' assignments without operator action.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Unschedule prior version if it exists (idempotent)
DO $$
BEGIN
  PERFORM cron.unschedule('aurixa-brand-drift-scan');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'aurixa-brand-drift-scan',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://aurixa-mission-control.lovable.app/hooks/brand-drift',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.supabase_anon_key', true)
    ),
    body := jsonb_build_object('source', 'pg_cron')
  ) AS request_id;
  $$
);