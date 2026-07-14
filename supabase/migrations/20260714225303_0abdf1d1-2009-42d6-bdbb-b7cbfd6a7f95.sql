-- Secret management for clone backend provisioning
-- 1) Prime-side whitelist: names that provisioning is allowed to forward
--    from the prime's environment into a newly-created clone backend.
create table if not exists public.prime_secret_forwards (
  name text primary key,
  inherit boolean not null default true,
  description text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.prime_secret_forwards to authenticated;
grant all on public.prime_secret_forwards to service_role;

alter table public.prime_secret_forwards enable row level security;

drop policy if exists "prime_secret_forwards admin read" on public.prime_secret_forwards;
create policy "prime_secret_forwards admin read"
  on public.prime_secret_forwards for select
  to authenticated
  using (public.is_admin(auth.uid()));

drop policy if exists "prime_secret_forwards admin write" on public.prime_secret_forwards;
create policy "prime_secret_forwards admin write"
  on public.prime_secret_forwards for all
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop trigger if exists prime_secret_forwards_updated_at on public.prime_secret_forwards;
create trigger prime_secret_forwards_updated_at
  before update on public.prime_secret_forwards
  for each row execute function public.update_updated_at_column();

-- 2) Per-clone tracking of which secrets have real values on the clone's
--    Supabase project. Populated by the provisioning worker and updated by
--    the admin "set secret" server function.
create table if not exists public.clone_backend_secrets (
  id uuid primary key default gen_random_uuid(),
  clone_id uuid not null references public.clones(id) on delete cascade,
  name text not null,
  status text not null check (status in ('missing','set','failed','inherited')),
  last_set_at timestamptz,
  last_error text,
  set_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clone_id, name)
);

grant select, insert, update, delete on public.clone_backend_secrets to authenticated;
grant all on public.clone_backend_secrets to service_role;

alter table public.clone_backend_secrets enable row level security;

drop policy if exists "clone_backend_secrets admin read" on public.clone_backend_secrets;
create policy "clone_backend_secrets admin read"
  on public.clone_backend_secrets for select
  to authenticated
  using (public.is_admin(auth.uid()));

drop policy if exists "clone_backend_secrets admin write" on public.clone_backend_secrets;
create policy "clone_backend_secrets admin write"
  on public.clone_backend_secrets for all
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop trigger if exists clone_backend_secrets_updated_at on public.clone_backend_secrets;
create trigger clone_backend_secrets_updated_at
  before update on public.clone_backend_secrets
  for each row execute function public.update_updated_at_column();

create index if not exists idx_clone_backend_secrets_status
  on public.clone_backend_secrets (clone_id, status);

-- 3) Seed sensible forward defaults. Operators can toggle inherit off per row.
insert into public.prime_secret_forwards (name, inherit, description) values
  ('LOVABLE_API_KEY', true,  'Lovable AI Gateway key — shared across clones by default'),
  ('VAPID_PUBLIC_KEY', false, 'Web-push public key — each clone should mint its own'),
  ('VAPID_PRIVATE_KEY', false, 'Web-push private key — each clone should mint its own'),
  ('VAPID_SUBJECT', true,  'mailto: contact for web-push VAPID identity'),
  ('STRIPE_SECRET_KEY', false, 'Payment processor key — set per-tenant'),
  ('STRIPE_WEBHOOK_SECRET', false, 'Stripe webhook signing secret — set per-tenant'),
  ('GITHUB_APP_ID', true,  'Shared Aurixa GitHub App identifier'),
  ('GITHUB_APP_PRIVATE_KEY', false, 'GitHub App private key — do not forward by default'),
  ('GITHUB_APP_INSTALLATION_ID', false, 'Per-clone GitHub App installation'),
  ('GITHUB_WEBHOOK_SECRET', true,  'Shared GitHub webhook signing secret'),
  ('LEAD_CAPTURE_SECRET', false, 'Lead capture HMAC — per-tenant landing page pairing'),
  ('DRIFT_REFRESH_TOKEN', false, 'Prime-only drift refresh token — do not forward'),
  ('SB_MGMT_API_TOKEN', false, 'Prime-only Supabase management token — do not forward'),
  ('SB_ORG_ID', false, 'Prime-only Supabase org id — do not forward')
on conflict (name) do nothing;