import { describe, expect, it } from "vitest";
import {
  calculateSourceSetSha256,
  loadRenderingSourceLock,
  projectRoot,
} from "../scripts/assets/manifest.mjs";
import {
  createMetadataSourceLock,
  refreshPolyHavenSourceLock,
} from "../scripts/assets/refresh-polyhaven-lock.mjs";

describe("Poly Haven metadata refresh", () => {
  it("recreates a v3 metadata lock without legacy machine state", () => {
    const current = loadRenderingSourceLock(projectRoot);
    const refreshed = createMetadataSourceLock(structuredClone(current.sources), current.policy);

    expect(refreshed).toMatchObject({
      version: 3,
      policy: {
        stage: "metadata-locked",
        license: "CC0",
        rawCache: ".cache/rendering-sources",
      },
    });
    expect(refreshed.policy).not.toHaveProperty("downloaded");
    expect(refreshed).not.toHaveProperty("defaults");
    expect(refreshed).not.toHaveProperty("review");
    expect(refreshed).not.toHaveProperty("integration");
    expect(refreshed.sourceSetSha256).toBe(calculateSourceSetSha256(refreshed.sources));
  });

  it("rejects legacy, reviewed, or malformed locks before making API requests", async () => {
    const current = loadRenderingSourceLock(projectRoot);
    const legacy = structuredClone(current);
    legacy.version = 2;
    await expect(refreshPolyHavenSourceLock(legacy)).rejects.toThrow(/Refusing to refresh/);

    const reviewed = structuredClone(current);
    reviewed.policy.stage = "sources-reviewed";
    await expect(refreshPolyHavenSourceLock(reviewed)).rejects.toThrow(/Refusing to refresh/);

    const mismatched = structuredClone(current);
    mismatched.sourceSetSha256 = "0".repeat(64);
    await expect(refreshPolyHavenSourceLock(mismatched)).rejects.toThrow(/Refusing to refresh/);
  });
});
