
ALTER TABLE public.cascade_results
ADD COLUMN IF NOT EXISTS previous_sha text;
