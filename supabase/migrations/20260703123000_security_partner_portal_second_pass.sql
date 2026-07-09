-- Security Partner Portal second pass
-- Direct report upload storage + Mission Control notifications.

-- Notification kinds surfaced in the existing notifications feed.
do $$
begin
  alter type public.notification_kind add value if not exists 'security_assessment_created';
  alter type public.notification_kind add value if not exists 'security_report_submitted';
  alter type public.notification_kind add value if not exists 'security_finding_created';
  alter type public.notification_kind add value if not exists 'security_retest_requested';
  alter type public.notification_kind add value if not exists 'security_assessment_closed';
exception
  when duplicate_object then null;
end $$;

-- Private bucket for direct partner report uploads. Reports are still represented
-- by public.security_reports metadata; this bucket stores the binary artifact.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'security-reports',
  'security-reports',
  false,
  52428800,
  array[
    'application/pdf',
    'application/zip',
    'image/png',
    'image/jpeg',
    'text/plain',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.security_storage_assessment_id(object_name text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return nullif(split_part(object_name, '/', 1), '')::uuid;
exception
  when others then
    return null;
end;
$$;

-- Partners can insert/select report files only when the first folder segment is
-- an assessment id they can access. Operators can read all report files.
drop policy if exists "Security report files are readable by assigned partners and operators" on storage.objects;
create policy "Security report files are readable by assigned partners and operators"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'security-reports'
    and (
      public.is_operator(auth.uid())
      or public.can_access_security_assessment(public.security_storage_assessment_id(name))
    )
  );

drop policy if exists "Security report files can be uploaded by assigned partners" on storage.objects;
create policy "Security report files can be uploaded by assigned partners"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'security-reports'
    and (
      public.is_operator(auth.uid())
      or public.can_access_security_assessment(public.security_storage_assessment_id(name))
    )
  );

drop policy if exists "Security report files are mutable only by operators" on storage.objects;
create policy "Security report files are mutable only by operators"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'security-reports' and public.is_operator(auth.uid()))
  with check (bucket_id = 'security-reports' and public.is_operator(auth.uid()));

drop policy if exists "Security report files are deletable only by operators" on storage.objects;
create policy "Security report files are deletable only by operators"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'security-reports' and public.is_operator(auth.uid()));

create or replace function public.security_notify_assessment_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  partner_name text;
  clone_name text;
begin
  select name into partner_name from public.security_partners where id = new.partner_id;
  select name into clone_name from public.clones where id = new.clone_id;

  insert into public.notifications(kind, severity, title, body, clone_id, url, metadata)
  values (
    'security_assessment_created',
    'info',
    'Security testing activated: ' || coalesce(clone_name, new.clone_id::text),
    coalesce(partner_name, 'Security partner') || ' was assigned to ' || replace(new.cycle, '_', '-') || ' penetration testing.',
    new.clone_id,
    '/clones/' || new.clone_id::text,
    jsonb_build_object('assessment_id', new.id, 'partner_id', new.partner_id, 'cycle', new.cycle)
  );
  return new;
end;
$$;

create or replace function public.security_notify_report_submitted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  clone_name text;
begin
  select name into clone_name from public.clones where id = new.clone_id;
  insert into public.notifications(kind, severity, title, body, clone_id, url, metadata)
  values (
    'security_report_submitted',
    'warning',
    'Security report submitted: ' || coalesce(clone_name, new.clone_id::text),
    new.label || ' is ready for Aurixa review before client release.',
    new.clone_id,
    '/security-partners',
    jsonb_build_object('assessment_id', new.assessment_id, 'report_id', new.id, 'report_type', new.report_type)
  );
  return new;
end;
$$;

create or replace function public.security_notify_finding_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  clone_name text;
  sev public.notification_severity := 'info';
begin
  select name into clone_name from public.clones where id = new.clone_id;
  if new.severity in ('critical', 'high') then
    sev := 'error';
  elsif new.severity = 'medium' then
    sev := 'warning';
  end if;

  insert into public.notifications(kind, severity, title, body, clone_id, url, metadata)
  values (
    'security_finding_created',
    sev,
    upper(new.severity) || ' security finding: ' || coalesce(clone_name, new.clone_id::text),
    new.title,
    new.clone_id,
    '/security-partners',
    jsonb_build_object('assessment_id', new.assessment_id, 'finding_id', new.id, 'severity', new.severity)
  );
  return new;
end;
$$;

create or replace function public.security_notify_status_transitions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  clone_name text;
begin
  if old.status is distinct from new.status then
    select name into clone_name from public.clones where id = new.clone_id;
    if new.status = 'retesting' then
      insert into public.notifications(kind, severity, title, body, clone_id, url, metadata)
      values (
        'security_retest_requested',
        'warning',
        'Security retest requested: ' || coalesce(clone_name, new.clone_id::text),
        'The partner cycle moved into retesting. Closure remains pending until validation is complete.',
        new.clone_id,
        '/security-partners',
        jsonb_build_object('assessment_id', new.id, 'partner_id', new.partner_id)
      );
    elsif new.status = 'closed' then
      insert into public.notifications(kind, severity, title, body, clone_id, url, metadata)
      values (
        'security_assessment_closed',
        'success',
        'Security assessment closed: ' || coalesce(clone_name, new.clone_id::text),
        'Aurixa review and partner closure have been recorded for this testing cycle.',
        new.clone_id,
        '/security-partners',
        jsonb_build_object('assessment_id', new.id, 'partner_id', new.partner_id)
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists security_assessment_created_notify on public.security_assessments;
create trigger security_assessment_created_notify
after insert on public.security_assessments
for each row execute function public.security_notify_assessment_created();

drop trigger if exists security_report_submitted_notify on public.security_reports;
create trigger security_report_submitted_notify
after insert on public.security_reports
for each row execute function public.security_notify_report_submitted();

drop trigger if exists security_finding_created_notify on public.security_findings;
create trigger security_finding_created_notify
after insert on public.security_findings
for each row execute function public.security_notify_finding_created();

drop trigger if exists security_assessment_status_notify on public.security_assessments;
create trigger security_assessment_status_notify
after update of status on public.security_assessments
for each row execute function public.security_notify_status_transitions();
