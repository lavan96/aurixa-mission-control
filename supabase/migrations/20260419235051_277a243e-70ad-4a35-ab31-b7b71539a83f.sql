-- Notification preferences per user
CREATE TABLE public.notification_preferences (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  muted_kinds public.notification_kind[] NOT NULL DEFAULT '{}',
  muted_severities public.notification_severity[] NOT NULL DEFAULT '{}',
  mute_toasts BOOLEAN NOT NULL DEFAULT false,
  mute_browser_push BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

-- Users can read their own prefs
CREATE POLICY "Users read own notification preferences"
ON public.notification_preferences
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Users can insert their own prefs
CREATE POLICY "Users insert own notification preferences"
ON public.notification_preferences
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Users can update their own prefs
CREATE POLICY "Users update own notification preferences"
ON public.notification_preferences
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

-- Users can delete their own prefs
CREATE POLICY "Users delete own notification preferences"
ON public.notification_preferences
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Operators can read all prefs (needed for server-side fan-out filtering)
CREATE POLICY "Operators read all notification preferences"
ON public.notification_preferences
FOR SELECT
TO authenticated
USING (public.is_operator(auth.uid()));

-- updated_at trigger
CREATE TRIGGER update_notification_preferences_updated_at
BEFORE UPDATE ON public.notification_preferences
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Index for quick lookup
CREATE INDEX idx_notification_preferences_user ON public.notification_preferences(user_id);