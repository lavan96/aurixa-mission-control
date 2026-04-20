ALTER TABLE public.prime_config
  ADD COLUMN IF NOT EXISTS default_cascade_mode public.cascade_mode NOT NULL DEFAULT 'pr';