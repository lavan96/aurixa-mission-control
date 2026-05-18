-- Allow tenants and API keys to belong to the prime repo (clone_id IS NULL)
ALTER TABLE public.tenants ALTER COLUMN clone_id DROP NOT NULL;

-- Ensure prime-repo tenants have a unique external_ref (NULLs are otherwise treated as distinct)
CREATE UNIQUE INDEX IF NOT EXISTS tenants_prime_external_ref_key
  ON public.tenants(external_ref)
  WHERE clone_id IS NULL;