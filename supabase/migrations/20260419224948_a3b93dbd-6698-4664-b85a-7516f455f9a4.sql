ALTER TABLE public.cascade_results REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.cascade_results;