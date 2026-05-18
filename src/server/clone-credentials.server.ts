/**
 * Cascade a clone's Aurixa API key into its own GitHub repository so the
 * clone's frontend can read it at build time. We write a small JSON file
 * (`.aurixa/credentials.json`) on the default branch via the GitHub App.
 *
 * The repo file is the authoritative on-clone copy. When the key is rotated
 * (from Mission Control or from the clone's own UI via the public rotate
 * endpoint), this same helper re-writes the file with the new value.
 */
import type { Octokit } from "@octokit/rest";
import { getAppOctokit } from "./github-app.server";

export type CredentialsCascade = {
  ok: boolean;
  commit_sha?: string | null;
  path: string;
  error?: string;
};

const CREDENTIALS_PATH = ".aurixa/credentials.json";

export async function cascadeApiKeyToRepo(opts: {
  owner: string;
  repo: string;
  branch: string;
  apiKey: string;
  apiKeyPrefix: string;
  reason: "initial" | "rotation";
  metadata?: Record<string, unknown>;
}): Promise<CredentialsCascade> {
  let octokit: Octokit;
  try {
    octokit = getAppOctokit();
  } catch (e) {
    return {
      ok: false,
      path: CREDENTIALS_PATH,
      error: e instanceof Error ? e.message : "GitHub App not configured",
    };
  }

  const payload = {
    apiKey: opts.apiKey,
    apiKeyPrefix: opts.apiKeyPrefix,
    rotatedAt: new Date().toISOString(),
    reason: opts.reason,
    metadata: opts.metadata ?? {},
    note: "Auto-managed by Aurixa Mission Control. Do not edit by hand — use the rotate endpoint instead.",
  };
  const content = Buffer.from(JSON.stringify(payload, null, 2) + "\n").toString("base64");

  try {
    // Read existing SHA if any (required for updates)
    let existingSha: string | undefined;
    try {
      const res = await octokit.repos.getContent({
        owner: opts.owner,
        repo: opts.repo,
        path: CREDENTIALS_PATH,
        ref: opts.branch,
      });
      const data = res.data as { type?: string; sha?: string };
      if (data.type === "file" && data.sha) existingSha = data.sha;
    } catch (e) {
      if ((e as { status?: number })?.status !== 404) throw e;
    }

    const commit = await octokit.repos.createOrUpdateFileContents({
      owner: opts.owner,
      repo: opts.repo,
      path: CREDENTIALS_PATH,
      branch: opts.branch,
      message:
        opts.reason === "initial"
          ? "chore(aurixa): seed Mission Control API key"
          : `chore(aurixa): rotate Mission Control API key (${opts.apiKeyPrefix}…)`,
      content,
      sha: existingSha,
    });

    return {
      ok: true,
      path: CREDENTIALS_PATH,
      commit_sha: commit.data.commit.sha ?? null,
    };
  } catch (e) {
    return {
      ok: false,
      path: CREDENTIALS_PATH,
      error: e instanceof Error ? e.message : "Failed to cascade credentials",
    };
  }
}
