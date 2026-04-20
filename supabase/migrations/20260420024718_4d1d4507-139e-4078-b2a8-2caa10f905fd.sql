-- Add default_cascade_mode for the GitHub webhook to know how to react to prime pushes,
-- and ensure pg_cron + pg_net are available so we can schedule the drift refresh hook.
ALTER TABLE public.prime_config
  ADD COLUMN IF NOT EXISTS default_cascade_mode public.cascade_mode NOT NULL DEFAULT 'pr';

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;