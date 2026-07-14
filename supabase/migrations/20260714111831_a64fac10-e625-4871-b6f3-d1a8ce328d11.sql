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