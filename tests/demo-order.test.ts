import { describe, expect, it } from "vitest";
import { demoOrder } from "../src/data/demo-order";
import { effectiveHardwareReview, renderingAcceptance } from "../src/data/rendering-acceptance";
import { demoRegistry } from "../src/demos/core/registry";

describe("canonical Demo order", () => {
  it("contains every registered Demo exactly once", () => {
    expect(demoOrder).toHaveLength(8);
    expect(new Set(demoOrder).size).toBe(8);

    const registered = Object.keys(demoRegistry).sort();
    expect([...demoOrder].sort()).toEqual(registered);
  });

  it("has one hardware acceptance entry per Demo", () => {
    expect(renderingAcceptance.demos).toHaveLength(8);
    expect(renderingAcceptance.demos.map((entry) => entry.slug).sort()).toEqual(
      [...demoOrder].sort(),
    );
    expect(
      renderingAcceptance.demos.every((entry) => ["pending", "passed"].includes(entry.status)),
    ).toBe(true);
  });

  it("does not accept a per-Demo pass without a reviewed run", () => {
    const entry = renderingAcceptance.demos[0];
    const originalEntryStatus = entry.status;
    const originalStatus = renderingAcceptance.status;
    const originalRun = renderingAcceptance.reviewedRun;
    try {
      entry.status = "passed";
      renderingAcceptance.status = "reviewed";
      renderingAcceptance.reviewedRun = null;
      expect(effectiveHardwareReview(entry.slug)).toBe("pending");

      renderingAcceptance.reviewedRun = { receipt: "fixture" };
      expect(effectiveHardwareReview(entry.slug)).toBe("passed");
    } finally {
      entry.status = originalEntryStatus;
      renderingAcceptance.status = originalStatus;
      renderingAcceptance.reviewedRun = originalRun;
    }
  });
});
