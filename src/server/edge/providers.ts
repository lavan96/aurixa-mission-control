// Multi-provider edge-security abstraction.
// Cloudflare is live; AWS and Azure are UI-only mocks in Phase 1.
export type EdgeProviderSlug = "cloudflare" | "aws" | "azure";

export type EdgePosture = {
  security_level?: "off" | "essentially_off" | "low" | "medium" | "high" | "under_attack";
  bot_fight?: boolean;
  rate_limit_rps?: number;
  waf_preset?: "lenient" | "balanced" | "strict";
};

export type AttachInput = {
  cloneId: string;
  hostname?: string;
  externalRef?: string; // existing zone/distribution to attach
  accountRef?: string;
  posture?: EdgePosture;
};

export type AttachResult = {
  externalRef: string;
  hostname?: string;
  accountRef?: string;
  status: "active" | "pending_ns" | "waitlisted" | "pending";
  nameservers?: string[];
  raw?: unknown;
};

export type ProviderAnalytics = {
  requests: number;
  threats: number;
  bandwidth: number;
};

export interface EdgeProvider {
  slug: EdgeProviderSlug;
  status: "live" | "mocked";
  attach(input: AttachInput): Promise<AttachResult>;
  applyPosture(externalRef: string, posture: EdgePosture): Promise<string[]>;
  syncState(externalRef: string): Promise<{ posture: EdgePosture; raw?: unknown }>;
  detach(externalRef: string): Promise<void>;
  analytics(externalRef: string, sinceHours?: number): Promise<ProviderAnalytics>;
}

const registry = new Map<EdgeProviderSlug, EdgeProvider>();

export function registerEdgeProvider(p: EdgeProvider) {
  registry.set(p.slug, p);
}

export function getEdgeProvider(slug: EdgeProviderSlug): EdgeProvider {
  const p = registry.get(slug);
  if (!p) throw new Error(`Edge provider not registered: ${slug}`);
  return p;
}

export function listEdgeProviders(): EdgeProvider[] {
  return Array.from(registry.values());
}
