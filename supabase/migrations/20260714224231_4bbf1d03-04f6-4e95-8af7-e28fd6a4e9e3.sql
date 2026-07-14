DO $$
DECLARE
  v_secret TEXT;
  v_headers TEXT;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'cron_secret'
  LIMIT 1;

  IF v_secret IS NULL THEN
    RAISE NOTICE 'Vault entry cron_secret not found; skipping backend-provisioning-drain schedule. Add it and re-run.';
    RETURN;
  END IF;

  v_headers := jsonb_build_object(
    'Content-Type','application/json',
    'Authorization','Bearer ' || v_secret
  )::text;

  PERFORM cron.unschedule('backend-provisioning-drain-1min')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='backend-provisioning-drain-1min');

  PERFORM cron.schedule(
    'backend-provisioning-drain-1min', '* * * * *',
    format($f$SELECT net.http_post(
      url:='https://aurixa-mission-control.lovable.app/hooks/backend-provisioning-drain',
      headers:=%L::jsonb, body:='{}'::jsonb)$f$, v_headers)
  );
END $$;