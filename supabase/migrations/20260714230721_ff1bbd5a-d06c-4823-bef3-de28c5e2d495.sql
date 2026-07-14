-- Sprint on Issue #6: remove hardcoded credentials from database functions.
-- Move the Aurixa Systems storefront catalog sync target URL and bearer token
-- into Vault so they can rotate without a migration and are never checked in.

create extension if not exists pg_net;

create or replace function public.notify_storefront_catalog_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url   text;
  v_token text;
begin
  select decrypted_secret into v_url
  from vault.decrypted_secrets
  where name = 'storefront_catalog_sync_url'
  limit 1;

  select decrypted_secret into v_token
  from vault.decrypted_secrets
  where name = 'storefront_catalog_sync_token'
  limit 1;

  -- Missing config = no-op. The 15-minute reconcile cron still catches changes.
  if v_url is null or v_token is null then
    return null;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_token
    ),
    body := '{}'::jsonb
  );
  return null;
end;
$$;

-- Ensure triggers still point at the (now-hardened) function.
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

comment on function public.notify_storefront_catalog_sync() is
  'Fires the Aurixa Systems storefront catalog-sync edge function. Reads URL + bearer from Vault entries storefront_catalog_sync_url and storefront_catalog_sync_token. No-ops if either is missing.';
