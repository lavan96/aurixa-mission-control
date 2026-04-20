import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getAppOctokit } from "./github-app.server";
import type { Database } from "@/integrations/supabase/types";

// Real clone provisioning. For 'fork' and 'template' methods, we actually
// create the GitHub repo via the App; for 'clone' (independent), we just
// register the row and let the operator wire up the repo manually.

type ProvisioningMethod = Database["public"]["Enums"]["provisioning_method"];

export type ProvisionCloneInput = {
  name: string;
  slug: string;
  method: ProvisioningMethod;
  targetOwner: string; // org/user that will own the new repo
  tags: string[];
  cloudflareEnabled: boolean;
  notes: string;
  moduleIds: string[];
};

export type ProvisionCloneResult =
  | { ok: true; cloneId: string; githubUrl: string | null }
  | { ok: false; error: string };

export const provisionClone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: ProvisionCloneInput) => {
    if (!input?.name?.trim()) throw new Error("name is required");
    if (!input?.slug?.trim()) throw new Error("slug is required");
    if (!input?.targetOwner?.trim()) throw new Error("targetOwner is required");
    if (!["fork", "template", "clone"].includes(input.method)) {
      throw new Error("invalid method");
    }
    return input;
  })
  .handler(async ({ data, context }): Promise<ProvisionCloneResult> => {
    const { supabase, userId } = context;

    const { data: prime } = await supabase
      .from("prime_config")
      .select("*")
      .limit(1)
      .maybeSingle();
    if (!prime) {
      return { ok: false, error: "Prime not configured — set it up in Settings first" };
    }

    let githubOwner = data.targetOwner;
    let githubRepo = data.slug;
    let githubUrl: string | null = null;
    let lastSyncedSha: string | null = null;

    // Real GitHub work for fork / template
    if (data.method === "fork" || data.method === "template") {
      let octokit;
      try {
        octokit = getAppOctokit();
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : "GitHub App not configured",
        };
      }

      try {
        if (data.method === "fork") {
          const { data: forked } = await octokit.repos.createFork({
            owner: prime.github_owner,
            repo: prime.github_repo,
            organization: data.targetOwner,
            name: data.slug,
            default_branch_only: true,
          });
          githubOwner = forked.owner.login;
          githubRepo = forked.name;
          githubUrl = forked.html_url;
        } else {
          // template
          const { data: created } = await octokit.repos.createUsingTemplate({
            template_owner: prime.github_owner,
            template_repo: prime.github_repo,
            owner: data.targetOwner,
            name: data.slug,
            private: true,
            include_all_branches: false,
            description: `Aurixa clone of ${prime.github_owner}/${prime.github_repo}`,
          });
          githubOwner = created.owner.login;
          githubRepo = created.name;
          githubUrl = created.html_url;
        }

        // Fetch HEAD so we can record last_synced_sha = baseline
        try {
          const { data: br } = await octokit.repos.getBranch({
            owner: githubOwner,
            repo: githubRepo,
            branch: prime.default_branch || "main",
          });
          lastSyncedSha = br.commit.sha;
        } catch {
          // Fork/template can take a moment to propagate; not fatal.
          lastSyncedSha = null;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "GitHub repo creation failed";
        return { ok: false, error: msg };
      }
    }

    // Insert the clone row
    const { data: inserted, error: insertErr } = await supabase
      .from("clones")
      .insert({
        name: data.name,
        slug: data.slug,
        tags: data.tags,
        provisioning_method: data.method,
        github_owner: githubOwner,
        github_repo: githubRepo,
        github_url: githubUrl,
        default_branch: prime.default_branch || "main",
        cloudflare_enabled: data.cloudflareEnabled,
        sync_status: "in_sync",
        last_synced_sha: lastSyncedSha,
        last_cascade_at: lastSyncedSha ? new Date().toISOString() : null,
        owner_user_id: userId,
        notes: data.notes || null,
      })
      .select()
      .single();

    if (insertErr || !inserted) {
      return { ok: false, error: insertErr?.message ?? "Clone insert failed" };
    }

    // Install picked modules
    if (data.moduleIds.length > 0) {
      await supabase.from("clone_modules").insert(
        data.moduleIds.map((module_id) => ({
          clone_id: inserted.id,
          module_id,
          installed_by: userId,
        })),
      );
    }

    await supabase.from("audit_log").insert({
      action: "clone.created",
      entity_type: "clone",
      entity_id: inserted.id,
      actor_user_id: userId,
      metadata: {
        method: data.method,
        cloudflare: data.cloudflareEnabled,
        modules: data.moduleIds,
        github_url: githubUrl,
      },
    });

    await supabase.from("notifications").insert({
      kind: "clone_created",
      severity: "success",
      title: `Clone created: ${data.name}`,
      body:
        data.method === "clone"
          ? `Registered as independent clone (no repo created)`
          : `Provisioned via ${data.method} → ${githubOwner}/${githubRepo}`,
      clone_id: inserted.id,
      url: `/clones/${inserted.id}`,
      metadata: { method: data.method, cloudflare: data.cloudflareEnabled, github_url: githubUrl },
    });

    return { ok: true, cloneId: inserted.id, githubUrl };
  });
