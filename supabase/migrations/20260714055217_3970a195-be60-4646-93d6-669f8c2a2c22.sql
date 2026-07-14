
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Airtable → waitlist_leads mirror, hourly. Silent (no notifications).
SELECT cron.unschedule('airtable-waitlist-sync')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'airtable-waitlist-sync');

SELECT cron.schedule(
  'airtable-waitlist-sync',
  '17 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://aurixa-mission-control.lovable.app/hooks/airtable-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'DRIFT_REFRESH_TOKEN' LIMIT 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
