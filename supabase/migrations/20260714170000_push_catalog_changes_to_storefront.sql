-- Push catalog changes to the Aurixa Systems storefront mirror.
--
-- Mission Control is the source of truth for the storefront catalog. When any
-- catalog table changes here, fire the Aurixa Systems `catalog-sync` edge
-- function so its read mirror refreshes within seconds instead of waiting for
-- the 15-minute reconcile cron. catalog-sync re-pulls MC's own public catalog
-- and writes the Aurixa DB — it never writes back here, so there is no loop.
--
-- Triggers are STATEMENT-level and the call is async (pg_net), so a bulk edit
-- fires a single non-blocking request; catalog-sync is idempotent (full
-- re-pull), so coalescing many changes into one sync is correct.

create extension if not exists pg_net;

create or replace function public.notify_storefront_catalog_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url     := 'https://moeyytuduycrvvncdtme.supabase.co/functions/v1/catalog-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      -- Aurixa Systems anon (publishable) key. catalog-sync only pulls Mission
      -- Control's own public catalog and writes the Aurixa mirror.
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1vZXl5dHVkdXljcnZ2bmNkdG1lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwMjU0MjUsImV4cCI6MjA5OTYwMTQyNX0.gt65ttGRZJDRPuBlIkBP5RrJHHz1Mex94O62bKPdU8w'
    ),
    body := '{}'::jsonb
  );
  return null;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'seat_plans','topup_packs','setup_packages',
    'addon_modules','seat_roles','report_credit_costs'
  ]
  loop
    execute format('drop trigger if exists trg_storefront_catalog_sync on public.%I', t);
    execute format(
      'create trigger trg_storefront_catalog_sync '
      'after insert or update or delete on public.%I '
      'for each statement execute function public.notify_storefront_catalog_sync()',
      t
    );
  end loop;
end $$;
