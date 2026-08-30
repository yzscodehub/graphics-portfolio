import { describe, expect, it } from "vitest";
import {
  PARTICLE_COUNTS,
  createParticleData,
  createParticleSeed,
  normalizedAttractorDelta,
} from "../src/demos/gpu-particles";

describe("GPU particle seed contract", () => {
  it("keeps the fixed public particle count presets", () => {
    expect(PARTICLE_COUNTS).toEqual([25_000, 100_000, 250_000]);
  });

  it("generates deterministic finite lifecycle state", () => {
    expect(createParticleSeed(17)).toEqual(createParticleSeed(17));
    const data = createParticleData(32);
    expect(data).toHaveLength(32 * 8);
    expect(Array.from(data).every(Number.isFinite)).toBe(true);
    for (let index = 0; index < 32; index += 1) {
      const offset = index * 8;
      expect(data[offset + 4]).toBeGreaterThanOrEqual(0);
      expect(data[offset + 5]).toBeGreaterThan(data[offset + 4]);
      expect(data[offset + 5]).toBeGreaterThanOrEqual(2.5);
    }
  });

  it("keeps attractor directions finite at the singularity", () => {
    expect(normalizedAttractorDelta(0, 0)).toEqual([0, 0]);
    expect(normalizedAttractorDelta(3, 4)).toEqual([0.6, 0.8]);
  });
});
