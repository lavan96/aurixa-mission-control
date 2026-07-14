-- Waitlist lead capture (landing-page → Mission Control tie-up).
--
-- The Aurixa Systems site waitlist form fires a Make.com webhook that stores
-- each lead in Airtable. This migration gives Mission Control its own durable
-- copy so operators can review the full lead history (/leads) and get a live
-- notification the moment a new lead lands.
--
-- Writes go exclusively through the service role via
-- POST /api/public/leads/capture — there is deliberately NO insert policy for
-- authenticated users. Operators read, triage (status/notes), and delete.

-- Lead triage lifecycle
DO $$ BEGIN
  CREATE TYPE public.lead_status AS ENUM (
    'new',
    'contacted',
    'qualified',
    'disqualified',
    'converted'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS public.waitlist_leads (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at             timestamptz NOT NULL DEFAULT now(),
  -- When the visitor actually hit "Submit" on the site (from the payload);
  -- created_at is when the row reached Mission Control.
  submitted_at           timestamptz,
  first_name             text NOT NULL,
  last_name              text NOT NULL,
  email                  text NOT NULL,
  mobile_number          text,
  entity_name            text,
  entity_classification  text,
  transaction_volume     text,
  tech_stack_bottlenecks text,
  source                 text NOT NULL DEFAULT 'unknown',
  page                   text,
  status                 public.lead_status NOT NULL DEFAULT 'new',
  notes                  text,
  -- Same submission delivered via both the website dual-write and the
  -- Make.com forward collapses to a single row (hash of email + submittedAt).
  dedupe_key             text UNIQUE,
  metadata               jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_waitlist_leads_created_at
  ON public.waitlist_leads (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_waitlist_leads_email
  ON public.waitlist_leads (lower(email));
CREATE INDEX IF NOT EXISTS idx_waitlist_leads_status
  ON public.waitlist_leads (status, created_at DESC);

ALTER TABLE public.waitlist_leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Operators read waitlist leads" ON public.waitlist_leads;
CREATE POLICY "Operators read waitlist leads"
  ON public.waitlist_leads FOR SELECT
  TO authenticated
  USING (public.is_operator(auth.uid()));

DROP POLICY IF EXISTS "Operators update waitlist leads" ON public.waitlist_leads;
CREATE POLICY "Operators update waitlist leads"
  ON public.waitlist_leads FOR UPDATE
  TO authenticated
  USING (public.is_operator(auth.uid()));

DROP POLICY IF EXISTS "Operators delete waitlist leads" ON public.waitlist_leads;
CREATE POLICY "Operators delete waitlist leads"
  ON public.waitlist_leads FOR DELETE
  TO authenticated
  USING (public.is_operator(auth.uid()));

-- Realtime: the /leads page and the notifications bell subscribe to INSERTs.
ALTER TABLE public.waitlist_leads REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'waitlist_leads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.waitlist_leads;
  END IF;
END $$;

-- Notification fanout kind for new leads
ALTER TYPE public.notification_kind ADD VALUE IF NOT EXISTS 'lead_captured';
