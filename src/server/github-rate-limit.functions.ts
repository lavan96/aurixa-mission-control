// Returns the current GitHub App installation rate-limit window.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getAppOctokit } from "./github-app.server";

export const getGitHubRateLimit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    try {
      const octokit = getAppOctokit();
      const { data } = await octokit.rateLimit.get();
      const core = data.resources?.core;
      if (!core) return { ok: false as const, error: "No core rate limit" };
      return {
        ok: true as const,
        limit: core.limit,
        remaining: core.remaining,
        used: core.used,
        reset: core.reset, // epoch seconds
      };
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : "rate limit unavailable",
      };
    }
  });
