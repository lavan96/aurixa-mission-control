import { describe, it, expect } from "vitest";
import { parseCron, nextCronTick, describeCron } from "./cron";

describe("parseCron", () => {
  it("rejects expressions that are not 5 fields", () => {
    expect(parseCron("* * * *")).toBeNull();
    expect(parseCron("* * * * * *")).toBeNull();
    expect(parseCron("nonsense")).toBeNull();
    expect(parseCron("")).toBeNull();
  });

  it("parses wildcards into full ranges", () => {
    const p = parseCron("* * * * *")!;
    expect(p.minutes).toHaveLength(60);
    expect(p.hours).toHaveLength(24);
    expect(p.doms[0]).toBe(1);
    expect(p.doms.at(-1)).toBe(31);
    expect(p.months).toHaveLength(12);
    expect(p.dows).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("parses steps, ranges and lists", () => {
    expect(parseCron("*/15 * * * *")!.minutes).toEqual([0, 15, 30, 45]);
    expect(parseCron("0 0 1-3 * *")!.doms).toEqual([1, 2, 3]);
    expect(parseCron("0 9,17 * * *")!.hours).toEqual([9, 17]);
    expect(parseCron("0 9 * * 1")!.dows).toEqual([1]);
  });

  it("clamps out-of-range values to the field bounds", () => {
    // hours only go to 23, so 30 is dropped
    expect(parseCron("0 30 * * *")!.hours).toEqual([]);
  });
});

describe("nextCronTick", () => {
  it("returns the next matching minute strictly after `from`", () => {
    const from = new Date("2026-06-09T10:30:00.000Z");
    const next = nextCronTick("0 * * * *", from); // top of every hour
    expect(next?.toISOString()).toBe("2026-06-09T11:00:00.000Z");
  });

  it("is strictly after `from` even when `from` already matches", () => {
    const from = new Date("2026-06-09T11:00:00.000Z");
    const next = nextCronTick("0 * * * *", from);
    expect(next!.getTime()).toBeGreaterThan(from.getTime());
    expect(next?.toISOString()).toBe("2026-06-09T12:00:00.000Z");
  });

  it("handles step minutes", () => {
    const from = new Date("2026-06-09T10:07:00.000Z");
    expect(nextCronTick("*/15 * * * *", from)?.toISOString()).toBe("2026-06-09T10:15:00.000Z");
  });

  it("rolls over to the next day for a daily schedule", () => {
    const from = new Date("2026-06-09T10:00:00.000Z");
    expect(nextCronTick("0 0 * * *", from)?.toISOString()).toBe("2026-06-10T00:00:00.000Z");
  });

  it("returns null for an invalid expression", () => {
    expect(nextCronTick("not valid", new Date())).toBeNull();
  });
});

describe("describeCron", () => {
  it("recognizes common patterns", () => {
    expect(describeCron("0 * * * *")).toBe("Every hour");
    expect(describeCron("*/5 * * * *")).toBe("Every 5 minutes");
    expect(describeCron("0 */6 * * *")).toBe("Every 6 hours");
    expect(describeCron("0 0 * * *")).toBe("Daily at 00:00 UTC");
    expect(describeCron("0 9 * * 1")).toBe("Weekly on Mon at 09:00 UTC");
  });

  it("falls back to the raw expression when unrecognized", () => {
    expect(describeCron("7 3 5 6 2")).toBe("7 3 5 6 2");
    expect(describeCron("bad")).toBe("bad");
  });
});
