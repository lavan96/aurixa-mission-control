
-- =====================================================
-- Sprint 2: Data integrity hardening
-- =====================================================

-- ---------- 1. Explicit GRANTs (defense-in-depth) ----------
DO $$
DECLARE
  t text;
  -- Tables operators read but anon should never see
  authed_only text[] := ARRAY[
    'addon_modules','ai_usage_log','audit_log','billing_plans',
    'cascade_approvals','cascade_events','cascade_results','cascade_schedules','cascade_templates',
    'clone_api_keys','clone_backends','clone_brand_asset_variants','clone_brand_assignments',
    'clone_brand_history','clone_brand_profiles','clone_brand_versions','clone_drift_policies',
    'clone_health_snapshots','clone_library_pins','clone_modules','clone_seat_devices',
    'clone_seat_entitlements','clone_seats','clones','cloudflare_accounts','cloudflare_audit',
    'cloudflare_clone_config','fleet_digests','module_cascade_jobs','module_config_snapshots',
    'module_detection_runs','module_drift_alerts','module_import_edges','module_library','modules',
    'notification_preferences','notifications','prime_config','profiles','push_delivery_log',
    'push_subscriptions','report_credit_costs','report_jobs','route_errors','seat_audit',
    'seat_plans','seat_roles','setup_packages','setup_purchases','stripe_events','tenants',
    'token_api_rate_limits','token_balances','token_ledger','token_rates','token_webhook_deliveries',
    'token_webhook_endpoints','topup_packs','user_preferences','user_roles'
  ];
BEGIN
  FOREACH t IN ARRAY authed_only LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
      EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    END IF;
  END LOOP;
END$$;

-- ---------- 2. FK indexes ----------
CREATE INDEX IF NOT EXISTS idx_audit_log_actor_user_id ON public.audit_log(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_cascade_events_initiated_by ON public.cascade_events(initiated_by);
CREATE INDEX IF NOT EXISTS idx_cascade_schedules_last_cascade_event_id ON public.cascade_schedules(last_cascade_event_id);
CREATE INDEX IF NOT EXISTS idx_clone_api_keys_rotated_from ON public.clone_api_keys(rotated_from);
CREATE INDEX IF NOT EXISTS idx_clone_api_keys_rotated_to ON public.clone_api_keys(rotated_to);
CREATE INDEX IF NOT EXISTS idx_clone_brand_profiles_published_version_id ON public.clone_brand_profiles(published_version_id);
CREATE INDEX IF NOT EXISTS idx_clone_modules_installed_by ON public.clone_modules(installed_by);
CREATE INDEX IF NOT EXISTS idx_clone_seat_entitlements_seat_plan_id ON public.clone_seat_entitlements(seat_plan_id);
CREATE INDEX IF NOT EXISTS idx_clones_owner_user_id ON public.clones(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_module_detection_runs_previous_run_id ON public.module_detection_runs(previous_run_id);
CREATE INDEX IF NOT EXISTS idx_modules_detection_run_id ON public.modules(detection_run_id);
CREATE INDEX IF NOT EXISTS idx_notifications_cascade_event_id ON public.notifications(cascade_event_id);
CREATE INDEX IF NOT EXISTS idx_setup_purchases_setup_package_id ON public.setup_purchases(setup_package_id);
CREATE INDEX IF NOT EXISTS idx_tenants_plan_id ON public.tenants(plan_id);
CREATE INDEX IF NOT EXISTS idx_token_webhook_deliveries_endpoint_id ON public.token_webhook_deliveries(endpoint_id);

-- ---------- 3. Retention purge ----------
CREATE OR REPLACE FUNCTION public.purge_log_tables()
RETURNS TABLE(table_name text, deleted_rows bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r bigint;
BEGIN
  DELETE FROM public.ai_usage_log             WHERE created_at  < now() - interval '90 days';  GET DIAGNOSTICS r = ROW_COUNT; table_name := 'ai_usage_log';            deleted_rows := r; RETURN NEXT;
  DELETE FROM public.audit_log                WHERE created_at  < now() - interval '365 days'; GET DIAGNOSTICS r = ROW_COUNT; table_name := 'audit_log';               deleted_rows := r; RETURN NEXT;
  DELETE FROM public.cloudflare_audit         WHERE created_at  < now() - interval '180 days'; GET DIAGNOSTICS r = ROW_COUNT; table_name := 'cloudflare_audit';        deleted_rows := r; RETURN NEXT;
  DELETE FROM public.push_delivery_log        WHERE created_at  < now() - interval '60 days';  GET DIAGNOSTICS r = ROW_COUNT; table_name := 'push_delivery_log';       deleted_rows := r; RETURN NEXT;
  DELETE FROM public.route_errors             WHERE created_at  < now() - interval '90 days';  GET DIAGNOSTICS r = ROW_COUNT; table_name := 'route_errors';            deleted_rows := r; RETURN NEXT;
  DELETE FROM public.stripe_events            WHERE created_at  < now() - interval '180 days'; GET DIAGNOSTICS r = ROW_COUNT; table_name := 'stripe_events';           deleted_rows := r; RETURN NEXT;
  DELETE FROM public.token_api_rate_limits    WHERE window_start < now() - interval '14 days'; GET DIAGNOSTICS r = ROW_COUNT; table_name := 'token_api_rate_limits';   deleted_rows := r; RETURN NEXT;
  DELETE FROM public.token_webhook_deliveries WHERE created_at  < now() - interval '90 days';  GET DIAGNOSTICS r = ROW_COUNT; table_name := 'token_webhook_deliveries'; deleted_rows := r; RETURN NEXT;
  DELETE FROM public.fleet_digests            WHERE created_at  < now() - interval '365 days'; GET DIAGNOSTICS r = ROW_COUNT; table_name := 'fleet_digests';           deleted_rows := r; RETURN NEXT;
  DELETE FROM public.module_detection_runs    WHERE completed_at IS NOT NULL AND completed_at < now() - interval '180 days'; GET DIAGNOSTICS r = ROW_COUNT; table_name := 'module_detection_runs'; deleted_rows := r; RETURN NEXT;
  DELETE FROM public.cascade_events           WHERE completed_at IS NOT NULL AND completed_at < now() - interval '180 days'; GET DIAGNOSTICS r = ROW_COUNT; table_name := 'cascade_events';        deleted_rows := r; RETURN NEXT;
  DELETE FROM public.cascade_results          WHERE completed_at IS NOT NULL AND completed_at < now() - interval '180 days'; GET DIAGNOSTICS r = ROW_COUNT; table_name := 'cascade_results';       deleted_rows := r; RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_log_tables() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_log_tables() TO service_role;

-- ---------- 4. Daily cron ----------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-log-tables-daily') THEN
    PERFORM cron.unschedule('purge-log-tables-daily');
  END IF;
  PERFORM cron.schedule(
    'purge-log-tables-daily',
    '15 3 * * *',
    $cron$ SELECT public.purge_log_tables(); $cron$
  );
END$$;
