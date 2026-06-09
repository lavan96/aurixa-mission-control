import { describe, it, expect } from "vitest";
import { assessBlastRadius, AUTO_MERGE_THRESHOLD, HIGH_RISK_CLONE_COUNT } from "./blast-radius";

describe("assessBlastRadius", () => {
  it("does not require approval for auto_merge at or below the threshold", () => {
    const r = assessBlastRadius("auto_merge", AUTO_MERGE_THRESHOLD);
    expect(r.requiresApproval).toBe(false);
    expect(r.reason).toBeNull();
  });

  it("requires approval for auto_merge above the threshold", () => {
    const r = assessBlastRadius("auto_merge", AUTO_MERGE_THRESHOLD + 1);
    expect(r.requiresApproval).toBe(true);
    expect(r.reason).toContain("second operator");
  });

  it("does not gate small non-auto_merge cascades", () => {
    expect(assessBlastRadius("pr", AUTO_MERGE_THRESHOLD + 1).requiresApproval).toBe(false);
    expect(assessBlastRadius("notify", HIGH_RISK_CLONE_COUNT).requiresApproval).toBe(false);
  });

  it("requires approval for any mode above the high-risk clone count", () => {
    expect(assessBlastRadius("pr", HIGH_RISK_CLONE_COUNT + 1).requiresApproval).toBe(true);
    expect(assessBlastRadius("notify", HIGH_RISK_CLONE_COUNT + 1).requiresApproval).toBe(true);
  });

  it("echoes the clone count back", () => {
    expect(assessBlastRadius("pr", 7).cloneCount).toBe(7);
  });
});
