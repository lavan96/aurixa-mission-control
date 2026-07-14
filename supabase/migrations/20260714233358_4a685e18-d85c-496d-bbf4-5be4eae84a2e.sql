
ALTER TABLE public.clones
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS clones_owner_idempotency_key_uidx
  ON public.clones (owner_user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
