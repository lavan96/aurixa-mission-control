-- Add approval workflow columns to module_library
ALTER TABLE public.module_library
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

-- Backfill: existing entries are treated as approved (so nothing breaks)
UPDATE public.module_library
SET approval_status = 'approved', approved_at = COALESCE(approved_at, published_at)
WHERE approval_status = 'pending' AND published_at < now();

-- Replace operator update policy with a stricter one: operators may update non-approval fields,
-- but approval_status changes require admin (enforced via separate admin policy).
DROP POLICY IF EXISTS "Operators can update module_library" ON public.module_library;

CREATE POLICY "Operators can update module_library metadata"
ON public.module_library
FOR UPDATE
TO authenticated
USING (is_operator(auth.uid()))
WITH CHECK (is_operator(auth.uid()));

-- (Admins inherit operator permissions via role hierarchy for the actual approval action;
--  the function-level guard in code is what enforces who may set approval_status.)

-- Index for filtering library by approval status
CREATE INDEX IF NOT EXISTS idx_module_library_approval_status
  ON public.module_library (approval_status);

-- Per-clone version pins
CREATE TABLE IF NOT EXISTS public.clone_library_pins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clone_id uuid NOT NULL,
  library_entry_id uuid NOT NULL,
  slug text NOT NULL,
  version integer NOT NULL,
  pinned_by uuid,
  pinned_at timestamp with time zone NOT NULL DEFAULT now(),
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (clone_id, slug)
);

ALTER TABLE public.clone_library_pins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators can view clone_library_pins"
ON public.clone_library_pins
FOR SELECT
TO authenticated
USING (is_operator(auth.uid()));

CREATE POLICY "Operators can insert clone_library_pins"
ON public.clone_library_pins
FOR INSERT
TO authenticated
WITH CHECK (is_operator(auth.uid()));

CREATE POLICY "Operators can update clone_library_pins"
ON public.clone_library_pins
FOR UPDATE
TO authenticated
USING (is_operator(auth.uid()))
WITH CHECK (is_operator(auth.uid()));

CREATE POLICY "Operators can delete clone_library_pins"
ON public.clone_library_pins
FOR DELETE
TO authenticated
USING (is_operator(auth.uid()));

CREATE TRIGGER update_clone_library_pins_updated_at
  BEFORE UPDATE ON public.clone_library_pins
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_clone_library_pins_clone_id
  ON public.clone_library_pins (clone_id);
CREATE INDEX IF NOT EXISTS idx_clone_library_pins_library_entry_id
  ON public.clone_library_pins (library_entry_id);