import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchCompare } from "./github-diff.server";

/**
 * Fetch the file-level diff between two commits on a GitHub repo.
 * Uses the GitHub App Octokit to call the compare API.
 *
 * Requires authentication: this calls the GitHub App with caller-supplied
 * owner/repo, so without a gate any anonymous caller could read diffs of any
 * (private) repo the App is installed on.
 */
export const fetchFileDiff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { owner: string; repo: string; base: string; head: string }) => data)
  .handler(async ({ data }) => {
    return fetchCompare(data.owner, data.repo, data.base, data.head);
  });
