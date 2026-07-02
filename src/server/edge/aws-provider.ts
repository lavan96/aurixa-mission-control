// AWS CloudFront placeholder. Phase 1 is UI-only; every method is a no-op
// that returns a "mocked" / waitlisted shape so the orchestrator can treat
// AWS the same as Cloudflare.
import type { EdgeProvider } from "./providers";

export const awsProvider: EdgeProvider = {
  slug: "aws",
  status: "mocked",
  async attach(input) {
    return {
      externalRef: `mock-aws-${input.cloneId}`,
      hostname: input.hostname,
      status: "waitlisted",
    };
  },
  async applyPosture() {
    return ["mocked"];
  },
  async syncState() {
    return { posture: {} };
  },
  async detach() {
    return;
  },
  async analytics() {
    return { requests: 0, threats: 0, bandwidth: 0 };
  },
};
