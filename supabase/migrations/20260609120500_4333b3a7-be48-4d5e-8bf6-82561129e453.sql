-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 1 — close authorization holes.
--
-- 1) Cron hooks no longer authenticate with the PUBLIC Supabase publishable/anon
--    key. Reschedule the in-repo pg_cron jobs to send the dedicated cron secret
--    (read from the `app.settings.cron_secret` GUC) as a Bearer token, instead of
--    the anon key / a hardcoded JWT. The receiving hooks now require this secret.
--
--    OPERATOR ACTION REQUIRED:
--      • Set the app env var  CRON_SECRET=<random-strong-secret>
--      • Set the DB GUC       ALTER DATABASE postgres SET app.settings.cron_secret = '<same-secret>';
--      • Update any dashboard-defined cron jobs (run-schedules, fleet-drift,
--        warm-health, drift-refresh) to send  Authorization: Bearer <CRON_SECRET>.
--
-- 2) Lock down clone_backends: it stores anon_key, service_role_key and db_pass.
--    Operators previously had SELECT on the whole row, leaking those secrets.
--    Restrict the base table to admins and expose a non-secret view to operators.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── 1) Reschedule in-repo cron jobs onto the dedicated secret ────────────────
DO $$ BEGIN PERFORM cron.unschedule('aurixa-brand-drift-scan'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'aurixa-brand-drift-scan',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://aurixa-mission-control.lovable.app/hooks/brand-drift',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(current_setting('app.settings.cron_secret', true), '')
    ),
    body := jsonb_build_object('source', 'pg_cron')
  ) AS request_id;
  $$
);

DO $$ BEGIN PERFORM cron.unschedule('expire-reservations-5min'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'expire-reservations-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--0fb4d803-5071-4093-be25-5afbcf116476.lovable.app/hooks/expire-reservations',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(current_setting('app.settings.cron_secret', true), '')
    ),
    body := '{}'::jsonb
  );
  $$
);

DO $$ BEGIN PERFORM cron.unschedule('token-alerts-15min'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'token-alerts-15min',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--0fb4d803-5071-4093-be25-5afbcf116476.lovable.app/hooks/token-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(current_setting('app.settings.cron_secret', true), '')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ── 2) clone_backends: admins-only base table + non-secret operator view ─────
-- Drop the operator SELECT policy (it exposed service_role_key / db_pass / anon_key).
-- The existing "Admins can write clone_backends" ALL policy continues to cover
-- full admin read/write.
DROP POLICY IF EXISTS "Operators can read clone_backends" ON public.clone_backends;

-- Non-secret projection for operators. The view runs with the owner's
-- privileges (security_invoker = false) so it can read the base table, but access
-- is gated to operators by the WHERE clause and no secret columns are selected —
-- non-operators get zero rows and nobody reads the credentials through it.
CREATE OR REPLACE VIEW public.clone_backends_safe
WITH (security_invoker = false) AS
  SELECT
    id,
    clone_id,
    supabase_project_ref,
    supabase_url,
    region,
    admin_email,
    migration_version,
    status,
    error_message,
    status_detail,
    created_at,
    updated_at
  FROM public.clone_backends
  WHERE public.is_operator(auth.uid());

REVOKE ALL ON public.clone_backends_safe FROM anon;
GRANT SELECT ON public.clone_backends_safe TO authenticated;
