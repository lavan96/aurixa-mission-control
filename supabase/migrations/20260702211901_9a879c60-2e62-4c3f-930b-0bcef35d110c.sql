ALTER TABLE public.modules
  ADD COLUMN IF NOT EXISTS clone_migration_sql text,
  ADD COLUMN IF NOT EXISTS apply_on_install boolean NOT NULL DEFAULT false;