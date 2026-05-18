
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Unschedule if previously scheduled (idempotent)
DO $$ BEGIN
  PERFORM cron.unschedule('expire-reservations-5min');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN
  PERFORM cron.unschedule('token-alerts-15min');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'expire-reservations-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--0fb4d803-5071-4093-be25-5afbcf116476.lovable.app/hooks/expire-reservations',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(current_setting('app.drift_refresh_token', true), '')
    ),
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'token-alerts-15min',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--0fb4d803-5071-4093-be25-5afbcf116476.lovable.app/hooks/token-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(current_setting('app.drift_refresh_token', true), '')
    ),
    body := '{}'::jsonb
  );
  $$
);
