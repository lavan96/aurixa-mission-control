import { createServerFn } from "@tanstack/react-start";
import { fetchCompare } from "./github-diff.server";

/**
 * Fetch the file-level diff between two commits on a GitHub repo.
 * Uses the GitHub App Octokit to call the compare API.
 */
export const fetchFileDiff = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { owner: string; repo: string; base: string; head: string }) => data,
  )
  .handler(async ({ data }) => {
    return fetchCompare(data.owner, data.repo, data.base, data.head);
  });
