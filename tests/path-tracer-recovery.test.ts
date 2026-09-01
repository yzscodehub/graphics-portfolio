import { describe, expect, it } from "vitest";
import { OneAttemptDeviceRecoveryGate } from "../src/demos/core/runtime";

describe("Path Tracer device-loss recovery contract", () => {
  it("permits one current-generation rebuild and falls back on the second loss", () => {
    const recovery = new OneAttemptDeviceRecoveryGate();

    expect(recovery.claim(4, 3)).toBe("ignore");
    expect(recovery.claim(3, 3)).toBe("recover");
    expect(recovery.claim(3, 3)).toBe("ignore");
    recovery.complete(3);
    expect(recovery.claim(4, 4)).toBe("fallback");
  });

  it("clears only the in-flight guard on invalidation, not the one-attempt budget", () => {
    const recovery = new OneAttemptDeviceRecoveryGate();

    expect(recovery.claim(1, 1)).toBe("recover");
    recovery.invalidate();
    expect(recovery.claim(2, 2)).toBe("fallback");
  });
});
