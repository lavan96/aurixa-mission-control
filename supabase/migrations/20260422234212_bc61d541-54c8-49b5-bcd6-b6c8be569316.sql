-- Fix the malformed github_repo value (URL instead of repo name)
UPDATE public.prime_config
SET github_repo = 'npc-property-dashbord'
WHERE github_repo LIKE '%://%';