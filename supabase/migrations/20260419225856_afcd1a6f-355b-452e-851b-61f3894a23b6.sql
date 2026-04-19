-- Enable realtime for cascade_events and clones
ALTER TABLE public.cascade_events REPLICA IDENTITY FULL;
ALTER TABLE public.clones REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'cascade_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cascade_events;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'clones'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.clones;
  END IF;
END $$;