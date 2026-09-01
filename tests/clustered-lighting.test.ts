import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLUSTER_GRID,
  buildClusteredLightAssignments,
  buildDynamicLights,
  clusterBounds,
  clusteredPipelinePlan,
  clusterCount,
  clusterIndexForSample,
  compareFixedGpuClusterReadback,
  depthSliceForViewDepth,
  packClusterHeaders,
  packDynamicLights,
  verifyClusteredLightAssignments,
} from "../src/demos/clustered-lighting/core";
import { buildProceduralResearchCourtyard } from "../src/demos/research-courtyard/scene";

describe("clustered lighting CPU reference", () => {
  it("keeps the published light presets deterministic and finite", () => {
    expect(buildDynamicLights(64, 1.25)).toEqual(buildDynamicLights(64, 1.25));
    expect(buildDynamicLights(512, 0)).toHaveLength(512);
    expect(buildDynamicLights(64, 0).every((light) => Number.isFinite(light.position[2]))).toBe(
      true,
    );
  });

  it("maps depth and screen samples into valid clusters", () => {
    expect(clusterCount()).toBe(
      DEFAULT_CLUSTER_GRID.x * DEFAULT_CLUSTER_GRID.y * DEFAULT_CLUSTER_GRID.z,
    );
    expect(depthSliceForViewDepth(DEFAULT_CLUSTER_GRID.near)).toBe(0);
    expect(depthSliceForViewDepth(DEFAULT_CLUSTER_GRID.far)).toBe(DEFAULT_CLUSTER_GRID.z - 1);
    expect(clusterIndexForSample(0.5, 0.5, 4)).toBeGreaterThanOrEqual(0);
    expect(clusterBounds(0).zMin).toBe(DEFAULT_CLUSTER_GRID.near);
  });

  it("uses distinct pass DAGs rather than one mode uniform", () => {
    expect(clusteredPipelinePlan("naive", "final")).toEqual(["forward-final"]);
    expect(clusteredPipelinePlan("deferred", "final")).toEqual(["gbuffer", "deferred-fullscreen"]);
    expect(clusteredPipelinePlan("clustered", "final")).toEqual([
      "cluster-assign",
      "gbuffer",
      "clustered-fullscreen",
    ]);
    expect(clusteredPipelinePlan("naive", "gbuffer")).toEqual(["gbuffer", "deferred-fullscreen"]);
    expect(clusteredPipelinePlan("deferred", "cluster-heatmap")).toEqual([
      "cluster-assign",
      "gbuffer",
      "clustered-fullscreen",
    ]);
  });

  it("packs only intersecting lights and validates the uploaded list", () => {
    const lights = buildDynamicLights(64, 0);
    const result = buildClusteredLightAssignments(lights);
    const verification = verifyClusteredLightAssignments(lights, result);
    expect(verification.valid).toBe(true);
    expect(result.indices).toHaveLength(result.storedAssignments);
    expect(packClusterHeaders(result.headers)).toHaveLength(result.headers.length * 2);
    expect(packDynamicLights(lights)).toHaveLength(lights.length * 8);
  });

  it("counts overflow instead of silently wrapping a cluster light list", () => {
    const lights = Array.from({ length: 40 }, (_, id) => ({
      id,
      position: [0, 0, 5] as const,
      radius: 20,
      color: [1, 1, 1] as const,
      intensity: 1,
    }));
    const result = buildClusteredLightAssignments(lights, {
      x: 1,
      y: 1,
      z: 1,
      near: 0.4,
      far: 14,
      maxLightsPerCluster: 4,
    });
    expect(result.storedAssignments).toBe(4);
    expect(result.overflow).toBe(36);
    expect(verifyClusteredLightAssignments(lights, result).valid).toBe(true);
  });

  it("uses a self-authored CPU-built courtyard when no packed asset exists", () => {
    const scene = buildProceduralResearchCourtyard();
    expect(scene.source).toBe("procedural");
    expect(scene.boxes.length).toBeGreaterThanOrEqual(12);
    expect(scene.materials.map((material) => material.id)).toContain("mint-screen");
  });
  it("compares fixed GPU list storage with a CPU reference", () => {
    const lights = Array.from({ length: 3 }, (_, id) => ({
      id,
      position: [0, 0, 5] as const,
      radius: 20,
      color: [1, 1, 1] as const,
      intensity: 1,
    }));
    const reference = buildClusteredLightAssignments(lights, {
      x: 1,
      y: 1,
      z: 1,
      near: 0.4,
      far: 14,
      maxLightsPerCluster: 4,
    });
    const headers = new Uint32Array([0, 3]);
    const indices = new Uint32Array(4);
    indices.set(reference.indices);
    expect(compareFixedGpuClusterReadback(reference, { headers, indices, overflow: 0 }).valid).toBe(
      true,
    );
    headers[1] = 2;
    expect(compareFixedGpuClusterReadback(reference, { headers, indices, overflow: 0 }).valid).toBe(
      false,
    );
  });
});
