import { describe, expect, it } from "vitest";
import {
  buildMedianBvh,
  encodeBvhNodes,
  encodeTriangles,
  intersectBruteForce,
  intersectBvh,
  type Ray,
} from "../src/demos/path-tracer/bvh";
import { resolveDielectricInterface, runningMean } from "../src/demos/path-tracer";
import { createCornellScene, encodeMaterials } from "../src/demos/path-tracer/scene";

describe("path tracer CPU reference", () => {
  const scene = createCornellScene();
  const bvh = buildMedianBvh(scene.triangles);

  it("builds a flat median BVH and GPU-aligned buffers", () => {
    expect(bvh.nodes.length).toBeGreaterThan(1);
    expect(bvh.triangles).toHaveLength(scene.triangles.length);
    expect(encodeTriangles(bvh.triangles).byteLength).toBe(bvh.triangles.length * 64);
    expect(encodeBvhNodes(bvh.nodes).byteLength).toBe(bvh.nodes.length * 48);
    expect(encodeMaterials(scene.materials).byteLength).toBe(scene.materials.length * 32);
    expect(new Set(scene.materials.map((material) => material.type))).toEqual(
      new Set([0, 1, 2, 3]),
    );
  });

  it("matches brute-force triangle intersections", () => {
    const rays: Ray[] = [
      { origin: [0, 0.35, -4.5], direction: normalize([0, -0.2, 1]) },
      { origin: [0, 0.35, -4.5], direction: normalize([-0.24, -0.08, 1]) },
      { origin: [0, 0.35, -4.5], direction: normalize([0.28, -0.03, 1]) },
      { origin: [0, 0.35, -4.5], direction: normalize([-0.48, 0.15, 1]) },
      { origin: [0, 0.35, -4.5], direction: normalize([0.5, 0.2, 1]) },
    ];
    rays.forEach((ray) => {
      const brute = intersectBruteForce(ray, bvh.triangles);
      const accelerated = intersectBvh(ray, bvh);
      if (!brute) expect(accelerated).toBeUndefined();
      else expect(accelerated?.distance).toBeCloseTo(brute.distance, 5);
    });
  });

  it("uses a linear running mean", () => {
    let average = 0;
    [2, 4, 8, 10].forEach((sample, index) => {
      average = runningMean(average, sample, index);
    });
    expect(average).toBeCloseTo(6);
    expect(() => runningMean(0, 1, -1)).toThrow();
  });

  it("keeps the geometric normal and swaps incident/transmitted IOR across a dielectric", () => {
    const entering = resolveDielectricInterface([0, 0, -1], [0, 0, 2], 1.5);
    expect(entering.frontFace).toBe(true);
    expect(entering.orientedNormal).toEqual([0, 0, 1]);
    expect(entering.etaIncident).toBe(1);
    expect(entering.etaTransmitted).toBe(1.5);
    expect(entering.eta).toBeCloseTo(1 / 1.5);

    const exiting = resolveDielectricInterface([0, 0, 1], [0, 0, 2], 1.5);
    expect(exiting.frontFace).toBe(false);
    expect(exiting.orientedNormal).toEqual([0, 0, -1]);
    expect(exiting.etaIncident).toBe(1.5);
    expect(exiting.etaTransmitted).toBe(1);
    expect(exiting.eta).toBe(1.5);
  });
});

function normalize(value: [number, number, number]): [number, number, number] {
  const length = Math.hypot(...value);
  return [value[0] / length, value[1] / length, value[2] / length];
}
