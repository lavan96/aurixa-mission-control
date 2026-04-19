-- Notification kind enum
DO $$ BEGIN
  CREATE TYPE public.notification_kind AS ENUM (
    'cascade_completed',
    'cascade_failed',
    'cascade_partial',
    'cascade_started',
    'drift_high',
    'drift_medium',
    'clone_created',
    'clone_deleted',
    'module_installed',
    'module_removed'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.notification_severity AS ENUM ('info', 'success', 'warning', 'error');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS public.notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  kind          public.notification_kind NOT NULL,
  severity      public.notification_severity NOT NULL DEFAULT 'info',
  title         text NOT NULL,
  body          text,
  clone_id      uuid REFERENCES public.clones(id) ON DELETE CASCADE,
  cascade_event_id uuid REFERENCES public.cascade_events(id) ON DELETE SET NULL,
  url           text,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at       timestamptz
);

CREATE INDEX IF NOT EXISTS idx_notifications_created_at
  ON public.notifications (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_clone_id
  ON public.notifications (clone_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON public.notifications (read_at) WHERE read_at IS NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Operators read notifications" ON public.notifications;
CREATE POLICY "Operators read notifications"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (public.is_operator(auth.uid()));

DROP POLICY IF EXISTS "Operators insert notifications" ON public.notifications;
CREATE POLICY "Operators insert notifications"
  ON public.notifications FOR INSERT
  TO authenticated
  WITH CHECK (public.is_operator(auth.uid()));

DROP POLICY IF EXISTS "Operators update notifications" ON public.notifications;
CREATE POLICY "Operators update notifications"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (public.is_operator(auth.uid()));

DROP POLICY IF EXISTS "Operators delete notifications" ON public.notifications;
CREATE POLICY "Operators delete notifications"
  ON public.notifications FOR DELETE
  TO authenticated
  USING (public.is_operator(auth.uid()));

-- Realtime
ALTER TABLE public.notifications REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;