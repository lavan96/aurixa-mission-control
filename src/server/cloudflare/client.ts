// Cloudflare API v4 client — typed wrapper used by all server functions.
// Reads CLOUDFLARE_API_TOKEN from process.env (server-only).

const CF_BASE = "https://api.cloudflare.com/client/v4";

export class CloudflareError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly errors: unknown,
  ) {
    super(message);
  }
}

type CFResponse<T> = {
  success: boolean;
  result: T;
  errors: Array<{ code: number; message: string }>;
  messages: Array<{ code: number; message: string }>;
};

function token(): string {
  const t = process.env.CLOUDFLARE_API_TOKEN;
  if (!t) throw new Error("CLOUDFLARE_API_TOKEN not configured");
  return t;
}

async function cf<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${CF_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const json = (await res.json()) as CFResponse<T>;
  if (!res.ok || !json.success) {
    throw new CloudflareError(
      json.errors?.[0]?.message ?? `Cloudflare API ${res.status}`,
      res.status,
      json.errors,
    );
  }
  return json.result;
}

export type CFZone = {
  id: string;
  name: string;
  status: string;
  account: { id: string; name: string };
  plan?: { name: string };
};

export const cloudflareApi = {
  verifyToken: () => cf<{ id: string; status: string }>("/user/tokens/verify"),
  listZones: (accountId?: string) =>
    cf<CFZone[]>(
      `/zones?per_page=50${accountId ? `&account.id=${accountId}` : ""}`,
    ),
  getZone: (zoneId: string) => cf<CFZone>(`/zones/${zoneId}`),
  setSecurityLevel: (zoneId: string, value: "off" | "essentially_off" | "low" | "medium" | "high" | "under_attack") =>
    cf(`/zones/${zoneId}/settings/security_level`, {
      method: "PATCH",
      body: JSON.stringify({ value }),
    }),
  setBotFightMode: (zoneId: string, enabled: boolean) =>
    cf(`/zones/${zoneId}/bot_management`, {
      method: "PUT",
      body: JSON.stringify({ fight_mode: enabled }),
    }).catch(() =>
      // Fallback for free plans
      cf(`/zones/${zoneId}/settings/security_level`, {
        method: "PATCH",
        body: JSON.stringify({ value: enabled ? "high" : "medium" }),
      }),
    ),
  getAnalytics: (zoneId: string, sinceHours = 24) =>
    cf<{
      totals: {
        requests: { all: number };
        threats: { all: number };
        bandwidth: { all: number };
      };
    }>(
      `/zones/${zoneId}/analytics/dashboard?since=-${sinceHours * 60}&until=0`,
    ).catch(() => ({
      totals: { requests: { all: 0 }, threats: { all: 0 }, bandwidth: { all: 0 } },
    })),
};
