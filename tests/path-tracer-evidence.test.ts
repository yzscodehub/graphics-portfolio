import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { analyzeBvhTraversalCapacity, buildMedianBvh } from "../src/demos/path-tracer/bvh";
import {
  LOW_FREQUENCY_REFERENCE_SHA256,
  makeLowFrequencyConvergenceEvidence,
  serializeLowFrequencyConvergence,
} from "../src/demos/path-tracer/convergence";
import { replaceResourcesAfterSuccess } from "../src/demos/path-tracer/renderer";
import { createCornellScene } from "../src/demos/path-tracer/scene";

describe("Path Tracer evidence contracts", () => {
  it("binds actual low-frequency sample MSE measurements to a self-made high-sample reference", () => {
    const evidence = makeLowFrequencyConvergenceEvidence();
    const actualHash = createHash("sha256")
      .update(serializeLowFrequencyConvergence(evidence))
      .digest("hex");

    expect(evidence.referenceSamples).toBe(4096);
    expect(evidence.lanes).toBe(16);
    expect(evidence.points.map((point) => point.spp)).toEqual([1, 2, 4, 8, 16, 32, 64]);
    expect(evidence.points.at(-1)?.mse).toBeLessThan(evidence.points[0].mse);
    expect(actualHash).toBe(LOW_FREQUENCY_REFERENCE_SHA256);
  });

  it("makes fixed-capacity BVH overflow observable instead of silent", () => {
    const bvh = buildMedianBvh(createCornellScene().triangles);
    const supported = analyzeBvhTraversalCapacity(bvh, 64);
    const constrained = analyzeBvhTraversalCapacity(bvh, 2);

    expect(supported.overflowCount).toBe(0);
    expect(supported.maxPendingNodes).toBeLessThanOrEqual(64);
    expect(constrained.overflowCount).toBeGreaterThan(0);
  });

  it("preserves old resources if replacement creation fails", () => {
    const oldResource = { id: "old" };
    const disposed: string[] = [];

    expect(() =>
      replaceResourcesAfterSuccess(
        oldResource,
        () => {
          throw new Error("allocation failed");
        },
        (resource) => disposed.push(resource.id),
      ),
    ).toThrow("allocation failed");
    expect(disposed).toEqual([]);

    const next = replaceResourcesAfterSuccess(
      oldResource,
      () => ({ id: "new" }),
      (resource) => disposed.push(resource.id),
    );
    expect(next.id).toBe("new");
    expect(disposed).toEqual(["old"]);
  });
});
