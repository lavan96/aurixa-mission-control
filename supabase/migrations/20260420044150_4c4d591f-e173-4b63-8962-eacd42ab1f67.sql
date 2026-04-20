-- Add approval-tracking columns on cascade_events
ALTER TABLE public.cascade_events
  ADD COLUMN IF NOT EXISTS requires_approval boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approved_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS approved_by uuid;

-- New table for the approval audit trail (one row per approval/rejection)
CREATE TABLE IF NOT EXISTS public.cascade_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cascade_event_id uuid NOT NULL REFERENCES public.cascade_events(id) ON DELETE CASCADE,
  approver_user_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  reason text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cascade_approvals_event_idx
  ON public.cascade_approvals (cascade_event_id);

ALTER TABLE public.cascade_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators read cascade_approvals"
  ON public.cascade_approvals FOR SELECT
  TO authenticated
  USING (public.is_operator(auth.uid()));

-- Second-operator rule enforced in policy: approver must NOT be the initiator
CREATE POLICY "Operators insert cascade_approvals (not self)"
  ON public.cascade_approvals FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_operator(auth.uid())
    AND approver_user_id = auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM public.cascade_events ce
      WHERE ce.id = cascade_event_id
        AND ce.initiated_by = auth.uid()
    )
  );

CREATE POLICY "Admins delete cascade_approvals"
  ON public.cascade_approvals FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));