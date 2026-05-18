
DO $$ BEGIN PERFORM cron.unschedule('expire-reservations-5min'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('token-alerts-15min'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'expire-reservations-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--0fb4d803-5071-4093-be25-5afbcf116476.lovable.app/hooks/expire-reservations',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZncHZhZ2Vqa2FlcWVkY3d2YnRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MTg5NjQsImV4cCI6MjA5MjE5NDk2NH0.efhmEPDZXMEvIMuTj0D-3X__PKuNcWeGNLEYLEVYMpY"}'::jsonb,
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
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZncHZhZ2Vqa2FlcWVkY3d2YnRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MTg5NjQsImV4cCI6MjA5MjE5NDk2NH0.efhmEPDZXMEvIMuTj0D-3X__PKuNcWeGNLEYLEVYMpY"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
