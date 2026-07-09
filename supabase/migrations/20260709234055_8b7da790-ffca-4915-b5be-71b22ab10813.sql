create extension if not exists pgcrypto;

create table if not exists public.security_partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'active' check (status in ('active','paused','offboarded')),
  primary_contact_name text,
  primary_contact_email text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.security_partner_memberships (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.security_partners(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  display_name text,
  role text not null default 'tester' check (role in ('partner_admin','tester','viewer')),
  status text not null default 'invited' check (status in ('invited','active','suspended','revoked')),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  accepted_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint security_partner_memberships_email_lower check (email = lower(email)),
  constraint security_partner_memberships_unique_partner_email unique (partner_id, email)
);

create table if not exists public.security_partner_assignments (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.security_partners(id) on delete cascade,
  clone_id uuid not null references public.clones(id) on delete cascade,
  status text not null default 'active' check (status in ('active','paused','revoked')),
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists security_partner_assignments_active_unique
  on public.security_partner_assignments(partner_id, clone_id) where revoked_at is null;

create table if not exists public.security_assessments (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.security_partners(id) on delete restrict,
  clone_id uuid not null references public.clones(id) on delete cascade,
  assignment_id uuid references public.security_partner_assignments(id) on delete set null,
  title text not null,
  cycle text not null default 'one_off' check (cycle in ('quarterly','bi_annual','annual','one_off')),
  status text not null default 'pending' check (status in ('pending','scheduled','in_progress','reporting','remediation_review','retesting','closed','blocked','canceled')),
  aurixa_review_status text not null default 'not_submitted' check (aurixa_review_status in ('not_submitted','submitted','in_review','changes_requested','approved','released_to_client')),
  scope_summary text,
  rules_of_engagement text,
  exclusions text,
  target_urls text[] not null default '{}',
  testing_window_start timestamptz,
  testing_window_end timestamptz,
  emergency_stop_contact text,
  escalation_contacts jsonb not null default '[]'::jsonb,
  remediation_owner text,
  retest_required boolean not null default false,
  client_release_approved boolean not null default false,
  due_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists security_assessments_partner_status_idx on public.security_assessments(partner_id, status, due_at);
create index if not exists security_assessments_clone_idx on public.security_assessments(clone_id);

create table if not exists public.security_findings (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.security_assessments(id) on delete cascade,
  partner_id uuid not null references public.security_partners(id) on delete restrict,
  clone_id uuid not null references public.clones(id) on delete cascade,
  title text not null,
  severity text not null default 'medium' check (severity in ('critical','high','medium','low','info')),
  status text not null default 'open' check (status in ('open','remediation_review','resolved','accepted_risk','false_positive')),
  affected_asset text,
  description text,
  evidence text,
  recommendation text,
  cvss text,
  cwe text,
  retest_status text not null default 'not_requested' check (retest_status in ('not_requested','pending','validated','failed')),
  submitted_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists security_findings_assessment_idx on public.security_findings(assessment_id, severity, status);

create table if not exists public.security_reports (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.security_assessments(id) on delete cascade,
  partner_id uuid not null references public.security_partners(id) on delete restrict,
  clone_id uuid not null references public.clones(id) on delete cascade,
  label text not null,
  report_type text not null default 'draft' check (report_type in ('draft','final','retest','evidence')),
  file_url text,
  file_path text,
  notes text,
  status text not null default 'submitted' check (status in ('submitted','aurixa_review','approved','changes_requested','released')),
  submitted_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists security_reports_assessment_idx on public.security_reports(assessment_id, submitted_at desc);

create table if not exists public.security_assessment_comments (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.security_assessments(id) on delete cascade,
  partner_id uuid not null references public.security_partners(id) on delete restrict,
  clone_id uuid not null references public.clones(id) on delete cascade,
  author_user_id uuid references auth.users(id) on delete set null,
  author_kind text not null check (author_kind in ('aurixa','partner','system')),
  visibility text not null default 'partner_thread' check (visibility in ('partner_thread','internal')),
  body text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists security_assessment_comments_assessment_idx on public.security_assessment_comments(assessment_id, created_at);

create table if not exists public.security_assessment_events (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid references public.security_assessments(id) on delete cascade,
  partner_id uuid references public.security_partners(id) on delete set null,
  clone_id uuid references public.clones(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_kind text not null default 'system' check (actor_kind in ('aurixa','partner','system')),
  event_type text not null,
  body text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists security_assessment_events_assessment_idx on public.security_assessment_events(assessment_id, created_at desc);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.security_partners TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.security_partner_memberships TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.security_partner_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.security_assessments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.security_findings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.security_reports TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.security_assessment_comments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.security_assessment_events TO authenticated;
GRANT ALL ON public.security_partners, public.security_partner_memberships, public.security_partner_assignments, public.security_assessments, public.security_findings, public.security_reports, public.security_assessment_comments, public.security_assessment_events TO service_role;

create or replace function public.is_security_partner_member(_partner_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.security_partner_memberships m
    where m.partner_id = _partner_id and m.user_id = auth.uid() and m.status = 'active');
$$;

create or replace function public.can_access_security_assessment(_assessment_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.security_assessments a
    join public.security_partner_memberships m
      on m.partner_id = a.partner_id and m.user_id = auth.uid() and m.status = 'active'
    where a.id = _assessment_id);
$$;

alter table public.security_partners enable row level security;
alter table public.security_partner_memberships enable row level security;
alter table public.security_partner_assignments enable row level security;
alter table public.security_assessments enable row level security;
alter table public.security_findings enable row level security;
alter table public.security_reports enable row level security;
alter table public.security_assessment_comments enable row level security;
alter table public.security_assessment_events enable row level security;

drop policy if exists "Operators can read security partners" on public.security_partners;
create policy "Operators can read security partners" on public.security_partners
  for select to authenticated using (public.is_operator(auth.uid()) or public.is_security_partner_member(id));
drop policy if exists "Admins can manage security partners" on public.security_partners;
create policy "Admins can manage security partners" on public.security_partners
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

drop policy if exists "Operators can read partner memberships" on public.security_partner_memberships;
create policy "Operators can read partner memberships" on public.security_partner_memberships
  for select to authenticated using (public.is_operator(auth.uid()) or user_id = auth.uid());
drop policy if exists "Admins can manage partner memberships" on public.security_partner_memberships;
create policy "Admins can manage partner memberships" on public.security_partner_memberships
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

drop policy if exists "Operators or assigned partners can read assignments" on public.security_partner_assignments;
create policy "Operators or assigned partners can read assignments" on public.security_partner_assignments
  for select to authenticated using (public.is_operator(auth.uid()) or public.is_security_partner_member(partner_id));
drop policy if exists "Admins can manage assignments" on public.security_partner_assignments;
create policy "Admins can manage assignments" on public.security_partner_assignments
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

drop policy if exists "Operators or assigned partners can read assessments" on public.security_assessments;
create policy "Operators or assigned partners can read assessments" on public.security_assessments
  for select to authenticated using (public.is_operator(auth.uid()) or public.is_security_partner_member(partner_id));
drop policy if exists "Admins can manage assessments" on public.security_assessments;
create policy "Admins can manage assessments" on public.security_assessments
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

drop policy if exists "Operators or assigned partners can read findings" on public.security_findings;
create policy "Operators or assigned partners can read findings" on public.security_findings
  for select to authenticated using (public.is_operator(auth.uid()) or public.is_security_partner_member(partner_id));
drop policy if exists "Admins can manage findings" on public.security_findings;
create policy "Admins can manage findings" on public.security_findings
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

drop policy if exists "Operators or assigned partners can read reports" on public.security_reports;
create policy "Operators or assigned partners can read reports" on public.security_reports
  for select to authenticated using (public.is_operator(auth.uid()) or public.is_security_partner_member(partner_id));
drop policy if exists "Admins can manage reports" on public.security_reports;
create policy "Admins can manage reports" on public.security_reports
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

drop policy if exists "Operators or assigned partners can read partner-thread comments" on public.security_assessment_comments;
create policy "Operators or assigned partners can read partner-thread comments" on public.security_assessment_comments
  for select to authenticated using (public.is_operator(auth.uid()) or (visibility = 'partner_thread' and public.is_security_partner_member(partner_id)));
drop policy if exists "Admins can manage comments" on public.security_assessment_comments;
create policy "Admins can manage comments" on public.security_assessment_comments
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

drop policy if exists "Operators or assigned partners can read events" on public.security_assessment_events;
create policy "Operators or assigned partners can read events" on public.security_assessment_events
  for select to authenticated using (public.is_operator(auth.uid()) or public.is_security_partner_member(partner_id));
drop policy if exists "Admins can manage events" on public.security_assessment_events;
create policy "Admins can manage events" on public.security_assessment_events
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

insert into public.security_partners (name, slug, status, notes, metadata)
values ('EC-Council', 'ec-council', 'active',
  'Seeded restricted cybersecurity delivery partner. Individual users still require explicit approval.',
  '{"source":"aurixa_ec_council_operating_model"}'::jsonb)
on conflict (slug) do nothing;

create or replace function public.security_storage_assessment_id(object_name text)
returns uuid language plpgsql stable security definer set search_path = public as $$
begin
  return nullif(split_part(object_name, '/', 1), '')::uuid;
exception when others then return null;
end;
$$;

drop policy if exists "Security report files are readable by assigned partners and operators" on storage.objects;
create policy "Security report files are readable by assigned partners and operators" on storage.objects
  for select to authenticated using (bucket_id = 'security-reports' and (public.is_operator(auth.uid()) or public.can_access_security_assessment(public.security_storage_assessment_id(name))));

drop policy if exists "Security report files can be uploaded by assigned partners" on storage.objects;
create policy "Security report files can be uploaded by assigned partners" on storage.objects
  for insert to authenticated with check (bucket_id = 'security-reports' and (public.is_operator(auth.uid()) or public.can_access_security_assessment(public.security_storage_assessment_id(name))));

drop policy if exists "Security report files are mutable only by operators" on storage.objects;
create policy "Security report files are mutable only by operators" on storage.objects
  for update to authenticated using (bucket_id = 'security-reports' and public.is_operator(auth.uid())) with check (bucket_id = 'security-reports' and public.is_operator(auth.uid()));

drop policy if exists "Security report files are deletable only by operators" on storage.objects;
create policy "Security report files are deletable only by operators" on storage.objects
  for delete to authenticated using (bucket_id = 'security-reports' and public.is_operator(auth.uid()));