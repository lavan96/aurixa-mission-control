// Azure Front Door placeholder. Phase 1 UI-only; identical shape to AWS mock.
import type { EdgeProvider } from "./providers";

export const azureProvider: EdgeProvider = {
  slug: "azure",
  status: "mocked",
  async attach(input) {
    return {
      externalRef: `mock-azure-${input.cloneId}`,
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
