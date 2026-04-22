import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type SecretValidation = {
  name: string;
  set: boolean;
  valid: boolean;
  hint?: string;
};

export type ValidationResult = {
  secrets: SecretValidation[];
  allValid: boolean;
};

export const validateGitHubSecrets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<ValidationResult> => {
    const secrets: SecretValidation[] = [];

    // GITHUB_APP_ID — must be a numeric string
    const appId = process.env.GITHUB_APP_ID ?? "";
    const appIdSet = appId.length > 0;
    const appIdValid = appIdSet && /^\d+$/.test(appId.trim());
    secrets.push({
      name: "GITHUB_APP_ID",
      set: appIdSet,
      valid: appIdValid,
      hint: !appIdSet
        ? "Not set. Find it at GitHub → Settings → Developer settings → GitHub Apps → your app."
        : !appIdValid
          ? `Value "${appId.slice(0, 4)}…" is not a valid numeric App ID. It should be a number like 123456.`
          : undefined,
    });

    // GITHUB_APP_INSTALLATION_ID — must be a numeric string
    const instId = process.env.GITHUB_APP_INSTALLATION_ID ?? "";
    const instIdSet = instId.length > 0;
    const instIdValid = instIdSet && /^\d+$/.test(instId.trim());
    secrets.push({
      name: "GITHUB_APP_INSTALLATION_ID",
      set: instIdSet,
      valid: instIdValid,
      hint: !instIdSet
        ? "Not set. Go to GitHub → Settings → Applications → Configure your app. The number in the URL is the installation ID."
        : !instIdValid
          ? `Value "${instId.slice(0, 4)}…" is not numeric. Check the URL: github.com/settings/installations/XXXXXXXX`
          : undefined,
    });

    // GITHUB_APP_PRIVATE_KEY — must start with -----BEGIN
    const pk = process.env.GITHUB_APP_PRIVATE_KEY ?? "";
    const pkSet = pk.length > 0;
    const normalized = pk.replace(/\\n/g, "\n");
    const pkValid = pkSet && normalized.includes("-----BEGIN");
    secrets.push({
      name: "GITHUB_APP_PRIVATE_KEY",
      set: pkSet,
      valid: pkValid,
      hint: !pkSet
        ? "Not set. Generate a private key in your GitHub App settings and paste the full PEM content."
        : !pkValid
          ? "Value doesn't look like a PEM key — it should start with -----BEGIN RSA PRIVATE KEY-----."
          : undefined,
    });

    return {
      secrets,
      allValid: secrets.every((s) => s.valid),
    };
  });
