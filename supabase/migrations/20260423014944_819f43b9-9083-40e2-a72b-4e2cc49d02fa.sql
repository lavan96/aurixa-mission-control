-- Create the webhook trigger function
CREATE OR REPLACE FUNCTION public.notify_push_fanout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _url text;
  _anon_key text;
BEGIN
  -- Build edge function URL
  _url := rtrim(current_setting('app.settings.supabase_url', true), '/') || '/functions/v1/push-fanout';
  _anon_key := current_setting('app.settings.supabase_anon_key', true);

  -- Fire-and-forget HTTP call via pg_net
  PERFORM net.http_post(
    url := _url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || _anon_key
    ),
    body := jsonb_build_object(
      'record', jsonb_build_object(
        'id', NEW.id,
        'title', NEW.title,
        'body', NEW.body,
        'kind', NEW.kind,
        'severity', NEW.severity,
        'url', NEW.url,
        'clone_id', NEW.clone_id,
        'cascade_event_id', NEW.cascade_event_id
      )
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Don't block notification inserts if push fails
  RAISE WARNING 'push-fanout trigger failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- Attach trigger
CREATE TRIGGER on_notification_push_fanout
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_push_fanout();
