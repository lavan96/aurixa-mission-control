// Cloudflare implementation of the EdgeProvider contract.
// Wraps the existing typed cloudflareApi client so retry + auth stay unified.
import { cloudflareApi } from "@/server/cloudflare/client";
import type {
  EdgeProvider,
  AttachInput,
  AttachResult,
  EdgePosture,
  ProviderAnalytics,
} from "./providers";

export const cloudflareProvider: EdgeProvider = {
  slug: "cloudflare",
  status: "live",

  async attach(input: AttachInput): Promise<AttachResult> {
    if (!input.externalRef) {
      throw new Error("Cloudflare attach requires an existing zoneId (externalRef).");
    }
    const zone = await cloudflareApi.getZone(input.externalRef);
    if (input.posture) {
      await this.applyPosture(zone.id, input.posture);
    }
    return {
      externalRef: zone.id,
      hostname: zone.name,
      accountRef: zone.account.id,
      status: zone.status === "active" ? "active" : "pending_ns",
      raw: zone,
    };
  },

  async applyPosture(zoneId: string, posture: EdgePosture): Promise<string[]> {
    const applied: string[] = [];
    if (posture.security_level) {
      await cloudflareApi.setSecurityLevel(zoneId, posture.security_level);
      applied.push(`security_level=${posture.security_level}`);
    }
    if (typeof posture.bot_fight === "boolean") {
      await cloudflareApi.setBotFightMode(zoneId, posture.bot_fight);
      applied.push(`bot_fight=${posture.bot_fight}`);
    }
    return applied;
  },

  async syncState(zoneId: string) {
    const zone = await cloudflareApi.getZone(zoneId);
    return { posture: {}, raw: zone };
  },

  async detach(_zoneId: string) {
    // Non-destructive: we never mutate the customer's zone on detach.
    return;
  },

  async analytics(zoneId: string, sinceHours = 24): Promise<ProviderAnalytics> {
    const a = await cloudflareApi.getAnalytics(zoneId, sinceHours);
    return {
      requests: a.totals.requests.all,
      threats: a.totals.threats.all,
      bandwidth: a.totals.bandwidth.all,
    };
  },
};
