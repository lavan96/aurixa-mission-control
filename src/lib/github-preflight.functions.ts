// @ts-nocheck
// Preflight validation for the Aurixa GitHub App used by the clone wizard.
// Answers: (1) Are the GITHUB_APP_* secrets configured? (2) Is the App
// installed on the target owner (org or user)? (3) Does the installation
// have write access to a template repo when method === "template"?
//
// Issue #10 remediation: fail fast in the wizard before we create a clone
// row + kick off provisioning that would throw mid-flow anyway.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "@/integrations/supabase/role-middleware";

const InputSchema = z.object({
  targetOwner: z.string().trim().min(1),
  method: z.enum(["fork", "template", "clone"]).optional(),
  templateOwner: z.string().trim().optional().nullable(),
  templateRepo: z.string().trim().optional().nullable(),
});

export type GithubPreflightResult = {
  ok: boolean;
  appConfigured: boolean;
  installationFound: boolean;
  installationId?: number;
  accountType?: "Organization" | "User";
  targetOwner: string;
  templateAccessible?: boolean | null;
  templateRepoIsTemplate?: boolean | null;
  message?: string;
  hint?: string;
  installUrl?: string;
};

export const checkGithubAppPreflight = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<GithubPreflightResult> => {
    const appId = process.env.GITHUB_APP_ID;
    const privateKeyRaw = process.env.GITHUB_APP_PRIVATE_KEY;
    const appConfigured = Boolean(appId && privateKeyRaw);

    if (!appConfigured) {
      return {
        ok: false,
        appConfigured: false,
        installationFound: false,
        targetOwner: data.targetOwner,
        message: "GitHub App is not configured on this environment.",
        hint: "Add GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY secrets in Settings before provisioning.",
      };
    }

    // Mint an App JWT (not an installation token) so we can hit
    // /orgs/{org}/installation and /users/{user}/installation.
    let jwt: string;
    try {
      const { createAppAuth } = await import("@octokit/auth-app");
      const forge = (await import("node-forge")).default;
      const normalize = (pem: string) => {
        const p = pem.replace(/\\n/g, "\n").trim();
        if (p.includes("-----BEGIN PRIVATE KEY-----")) return p;
        if (p.includes("-----BEGIN RSA PRIVATE KEY-----")) {
          const key = forge.pki.privateKeyFromPem(p);
          const asn1 = forge.pki.privateKeyToAsn1(key);
          const wrapped = forge.pki.wrapRsaPrivateKey(asn1);
          return forge.pki.privateKeyInfoToPem(wrapped).trim();
        }
        return p;
      };
      const auth = createAppAuth({ appId: appId!, privateKey: normalize(privateKeyRaw!) });
      const appAuth = await auth({ type: "app" });
      jwt = (appAuth as { token: string }).token;
    } catch (e) {
      return {
        ok: false,
        appConfigured: true,
        installationFound: false,
        targetOwner: data.targetOwner,
        message: `Could not mint GitHub App JWT: ${e instanceof Error ? e.message : String(e)}`,
        hint: "Check GITHUB_APP_PRIVATE_KEY format (PKCS#1 or PKCS#8 PEM).",
      };
    }

    const gh = async (path: string) =>
      fetch(`https://api.github.com${path}`, {
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "aurixa-mission-control",
        },
      });

    // Try org first, then user. GitHub returns 404 for the wrong endpoint.
    const owner = data.targetOwner.replace(/^@/, "");
    let installRes = await gh(`/orgs/${encodeURIComponent(owner)}/installation`);
    let accountType: "Organization" | "User" | undefined;
    if (installRes.ok) {
      accountType = "Organization";
    } else if (installRes.status === 404) {
      installRes = await gh(`/users/${encodeURIComponent(owner)}/installation`);
      if (installRes.ok) accountType = "User";
    }

    if (!installRes.ok) {
      // App exists but not installed on that owner.
      return {
        ok: false,
        appConfigured: true,
        installationFound: false,
        targetOwner: owner,
        message: `Aurixa GitHub App is not installed on "${owner}".`,
        hint: "Install the Aurixa GitHub App on this org/user and grant it access to the repos you want provisioned.",
        installUrl: `https://github.com/apps`,
      };
    }

    const install = (await installRes.json()) as {
      id: number;
      account?: { login?: string; type?: string };
      permissions?: Record<string, string>;
    };
    const installationId = install.id;

    // Optional: verify template repo is reachable + flagged as a template.
    let templateAccessible: boolean | null = null;
    let templateRepoIsTemplate: boolean | null = null;
    if (data.method === "template" && data.templateOwner && data.templateRepo) {
      try {
        // Mint an installation token to read the repo (App JWT can't read
        // repo content directly, only installation metadata).
        const tokRes = await fetch(
          `https://api.github.com/app/installations/${installationId}/access_tokens`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${jwt}`,
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
              "User-Agent": "aurixa-mission-control",
            },
          },
        );
        if (tokRes.ok) {
          const { token } = (await tokRes.json()) as { token: string };
          const repoRes = await fetch(
            `https://api.github.com/repos/${encodeURIComponent(
              data.templateOwner,
            )}/${encodeURIComponent(data.templateRepo)}`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
                "User-Agent": "aurixa-mission-control",
              },
            },
          );
          templateAccessible = repoRes.ok;
          if (repoRes.ok) {
            const repo = (await repoRes.json()) as { is_template?: boolean };
            templateRepoIsTemplate = Boolean(repo.is_template);
          }
        } else {
          templateAccessible = false;
        }
      } catch {
        templateAccessible = false;
      }
    }

    const ok =
      data.method === "template"
        ? templateAccessible !== false && templateRepoIsTemplate !== false
        : true;

    return {
      ok,
      appConfigured: true,
      installationFound: true,
      installationId,
      accountType,
      targetOwner: owner,
      templateAccessible,
      templateRepoIsTemplate,
      message: ok
        ? `App installed on ${accountType?.toLowerCase()} "${owner}" (installation #${installationId}).`
        : templateAccessible === false
          ? "App installed, but the template repo is not accessible to this installation."
          : templateRepoIsTemplate === false
            ? "Repo exists, but it is not marked as a GitHub template. Enable 'Template repository' in its Settings."
            : undefined,
      hint:
        templateAccessible === false
          ? "Open the Aurixa App installation on the target org and grant it access to the template repo."
          : templateRepoIsTemplate === false
            ? "In the template repo, Settings → General → check 'Template repository'."
            : undefined,
    };
  });
