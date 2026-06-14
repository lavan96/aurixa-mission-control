-- Credential-free projection of clone_backends for operator UI consumption.
-- Excludes service_role_key, db_pass, anon_key.
create or replace view public.clone_backends_safe
with (security_invoker = true)
as
select
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
from public.clone_backends;

grant select on public.clone_backends_safe to authenticated;
