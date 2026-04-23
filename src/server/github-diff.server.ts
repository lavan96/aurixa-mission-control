import { getAppOctokit } from "./github-app.server";

type DiffFile = {
  filename: string;
  status: "added" | "removed" | "modified" | "renamed";
  additions: number;
  deletions: number;
  patch?: string;
  oldContent?: string;
  newContent?: string;
};

type CompareResult =
  | { ok: true; files: DiffFile[] }
  | { ok: false; error: string };

/**
 * Fetch comparison between two SHAs using GitHub's compare API.
 * Returns per-file diffs with patch hunks.
 */
export async function fetchCompare(
  owner: string,
  repo: string,
  base: string,
  head: string,
): Promise<CompareResult> {
  try {
    const octokit = getAppOctokit();
    const { data } = await octokit.repos.compareCommitsWithBasehead({
      owner,
      repo,
      basehead: `${base}...${head}`,
    });

    const files: DiffFile[] = (data.files ?? []).map((f) => ({
      filename: f.filename,
      status: mapStatus(f.status),
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch,
    }));

    // For small diffs (≤15 files, each ≤50KB), fetch full file content for
    // side-by-side rendering. For larger diffs, the patch hunk is shown instead.
    if (files.length <= 15) {
      await Promise.allSettled(
        files
          .filter((f) => f.status !== "removed" && f.status !== "added")
          .map(async (f) => {
            try {
              const [oldRes, newRes] = await Promise.all([
                octokit.repos.getContent({ owner, repo, path: f.filename, ref: base }),
                octokit.repos.getContent({ owner, repo, path: f.filename, ref: head }),
              ]);
              const oldData = oldRes.data as { content?: string; size?: number };
              const newData = newRes.data as { content?: string; size?: number };
              // Skip large files
              if ((oldData.size ?? 0) > 50_000 || (newData.size ?? 0) > 50_000) return;
              if (oldData.content) {
                f.oldContent = Buffer.from(oldData.content, "base64").toString("utf8");
              }
              if (newData.content) {
                f.newContent = Buffer.from(newData.content, "base64").toString("utf8");
              }
            } catch {
              // Silently fall back to patch view
            }
          }),
      );

      // For added files, fetch only the new content
      await Promise.allSettled(
        files
          .filter((f) => f.status === "added")
          .map(async (f) => {
            try {
              const res = await octokit.repos.getContent({ owner, repo, path: f.filename, ref: head });
              const d = res.data as { content?: string; size?: number };
              if ((d.size ?? 0) > 50_000) return;
              if (d.content) {
                f.oldContent = "";
                f.newContent = Buffer.from(d.content, "base64").toString("utf8");
              }
            } catch {}
          }),
      );

      // For removed files, fetch only the old content
      await Promise.allSettled(
        files
          .filter((f) => f.status === "removed")
          .map(async (f) => {
            try {
              const res = await octokit.repos.getContent({ owner, repo, path: f.filename, ref: base });
              const d = res.data as { content?: string; size?: number };
              if ((d.size ?? 0) > 50_000) return;
              if (d.content) {
                f.oldContent = Buffer.from(d.content, "base64").toString("utf8");
                f.newContent = "";
              }
            } catch {}
          }),
      );
    }

    return { ok: true, files };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Not Found")) {
      return { ok: false, error: "Repository or commits not found. Check GitHub App permissions." };
    }
    return { ok: false, error: msg };
  }
}

function mapStatus(s: string): DiffFile["status"] {
  switch (s) {
    case "added":
      return "added";
    case "removed":
      return "removed";
    case "renamed":
      return "renamed";
    default:
      return "modified";
  }
}
