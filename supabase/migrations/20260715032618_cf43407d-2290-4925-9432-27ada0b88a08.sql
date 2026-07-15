create extension if not exists citext;

create table if not exists public.platform_hosting_config (
  id uuid primary key default gen_random_uuid(),
  singleton boolean not null default true,
  primary_domain text not null default 'aurixasystems.com.au',
  provider_slug text not null default 'cloudflare',
  cloudflare_account_id text,
  cloudflare_zone_id text,
  cloudflare_zone_name text,
  target_type text not null default 'a' check (target_type in ('a','cname')),
  target_value text not null default '185.158.133.1',
  proxied boolean not null default true,
  auto_provision boolean not null default true,
  subdomain_pattern text not null default '{slug}',
  reserved_slugs text[] not null default array[
    'www','api','admin','app','mail','ftp','staging','dev','test','prod',
    'auth','portal','dashboard','status','docs','blog','cdn','assets','static',
    'mission-control','aurixa','root','ns1','ns2'
  ],
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint platform_hosting_config_singleton_uidx unique (singleton)
);
grant select on public.platform_hosting_config to authenticated;
grant all on public.platform_hosting_config to service_role;
alter table public.platform_hosting_config enable row level security;
drop policy if exists "hosting_config_admin_read" on public.platform_hosting_config;
create policy "hosting_config_admin_read" on public.platform_hosting_config
for select to authenticated using (public.is_admin(auth.uid()));
drop policy if exists "hosting_config_admin_write" on public.platform_hosting_config;
create policy "hosting_config_admin_write" on public.platform_hosting_config
for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
insert into public.platform_hosting_config (singleton) values (true) on conflict do nothing;

alter table public.clones
  add column if not exists subdomain citext,
  add column if not exists subdomain_fqdn text,
  add column if not exists subdomain_status text;
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'clones_subdomain_status_check'
  ) then
    alter table public.clones add constraint clones_subdomain_status_check
      check (subdomain_status is null or subdomain_status in
        ('pending_platform','queued','provisioning','active','failed','detached'));
  end if;
end $$;
create unique index if not exists clones_subdomain_uidx
  on public.clones (subdomain) where subdomain is not null;

create table if not exists public.edge_dns_records (
  id uuid primary key default gen_random_uuid(),
  clone_id uuid not null references public.clones(id) on delete cascade,
  provider_slug text not null default 'cloudflare',
  zone_id text not null,
  external_record_id text not null,
  record_type text not null,
  record_name text not null,
  record_content text not null,
  proxied boolean not null default true,
  managed boolean not null default true,
  purpose text not null default 'clone_subdomain',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_slug, zone_id, external_record_id)
);
create index if not exists edge_dns_records_clone_idx on public.edge_dns_records (clone_id);
grant select on public.edge_dns_records to authenticated;
grant all on public.edge_dns_records to service_role;
alter table public.edge_dns_records enable row level security;
drop policy if exists "dns_records_admin_read" on public.edge_dns_records;
create policy "dns_records_admin_read" on public.edge_dns_records
for select to authenticated using (public.is_admin(auth.uid()));
drop policy if exists "dns_records_admin_write" on public.edge_dns_records;
create policy "dns_records_admin_write" on public.edge_dns_records
for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

do $$
declare cname text;
begin
  for cname in
    select conname from pg_constraint
     where conrelid = 'public.edge_provisioning_jobs'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%action%'
  loop
    execute format('alter table public.edge_provisioning_jobs drop constraint %I', cname);
  end loop;
end $$;
alter table public.edge_provisioning_jobs
  add constraint edge_provisioning_jobs_action_check
  check (action in ('attach','apply_posture','sync','detach',
                    'provision_subdomain','deprovision_subdomain','resync_subdomain'));