import { describe, expect, it } from "vitest";

import {
  alignLodToBaseNormalization,
  gltfpackArguments,
  preserveRecipePrimitives,
  reconcileResearchCourtyardLods,
} from "../scripts/assets/research-courtyard-lods.mjs";

function primitive(nodeName: string, triangles: number, marker = 0, materialName = "material") {
  const positions = Array.from({ length: Math.max(3, triangles + 2) }, (_, index) => [
    index,
    marker,
    index % 2,
  ]).flat();
  return {
    sourceId: "fixture",
    partId: "main",
    nodeName,
    primitiveIndex: 0,
    nodeWorldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    windingFlipped: false,
    positions,
    normals: Array.from({ length: positions.length / 3 }, () => [0, 1, 0]).flat(),
    tangents: Array.from({ length: positions.length / 3 }, () => [1, 0, 0, 1]).flat(),
    tangentFallback: false,
    uvs: Array.from({ length: positions.length / 3 }, () => [0, 0]).flat(),
    indices: Array.from({ length: triangles }, (_, index) => [0, index + 1, index + 2]).flat(),
    material: {
      name: materialName,
      alphaMode: "OPAQUE",
      alphaCutoff: 0.5,
      doubleSided: false,
      baseColorFactor: [1, 1, 1, 1],
      metallicFactor: 0,
      roughnessFactor: 1,
      textureTransform: null,
    },
  };
}

function geometry(entries: ReturnType<typeof primitive>[], translation = [0, 0, 0]) {
  return {
    format: "graphics-portfolio-research-courtyard-geometry",
    version: 1,
    sourceId: "fixture",
    parts: [
      {
        partId: "main",
        normalization: {
          mode: "ground-center",
          translation,
          sourceBounds: {
            min: [0, 0, 0],
            max: [1, 1, 1],
            center: [0.5, 0.5, 0.5],
            size: [1, 1, 1],
          },
        },
        bounds: {
          min: [0, 0, 0],
          max: [1, 1, 1],
          center: [0.5, 0.5, 0.5],
          size: [1, 1, 1],
        },
        primitives: entries,
      },
    ],
  };
}

function meshSource() {
  return {
    sourceId: "fixture",
    lod: {
      ratios: [1, 0.5, 0.2],
      maxErrors: [0, 0.01, 0.05],
      requireStrictDecrease: true,
      lod2DropNodeNames: ["bolt"],
    },
  };
}

describe("Research Courtyard LOD pipeline", () => {
  it("uses the verified gltfpack command with stable names, materials, and no quantization", () => {
    const tool = {
      id: "gltfpack",
      version: "1.1",
      commandPath: "gltfpack.exe",
      commandArgs: [],
    };
    expect(gltfpackArguments(tool, "in.gltf", "out.glb", 0.4, 0.01)).toEqual([
      "-i",
      "in.gltf",
      "-o",
      "out.glb",
      "-kn",
      "-km",
      "-noq",
      "-si",
      "0.4",
      "-se",
      "0.01",
    ]);
  });

  it("accepts real simplification, preserved sub-primitives, and explicit LOD2 drops", () => {
    const baseBody = primitive("body", 4);
    const baseBolt = primitive("bolt", 1);
    const lods = reconcileResearchCourtyardLods(meshSource(), [
      geometry([baseBody, baseBolt]),
      geometry([primitive("body", 2), baseBolt]),
      geometry([primitive("body", 1)]),
    ]);
    expect(lods.map((lod: { triangles: number }) => lod.triangles)).toEqual([5, 3, 1]);
    expect(lods.map((lod: { achievedRatio: number }) => lod.achievedRatio)).toEqual([1, 0.6, 0.2]);
    expect(
      lods[1].primitives.map((entry: { classification: string }) => entry.classification),
    ).toEqual(["simplified", "preserved"]);
    expect(lods[2].exclusions).toEqual([
      expect.objectContaining({ reason: "recipe-lod2-exclusion" }),
    ]);
  });

  it("replaces simplified alpha wire cards with the exact LOD0 geometry", () => {
    const baseWire = primitive("wire-card", 2, 0, "wire");
    const preserved = preserveRecipePrimitives(
      geometry([primitive("body", 2), primitive("wire-card", 1, 1, "wire")]),
      geometry([primitive("body", 4), baseWire]),
      {
        lod: { preserveWireCards: true },
        materialOverrides: [
          {
            materialName: "wire",
            alphaSource: { kind: "max-rgb" },
          },
        ],
      },
    );
    const wire = preserved.parts[0].primitives.find(
      (entry: { material: { name: string } }) => entry.material.name === "wire",
    );
    expect(wire).toEqual(baseWire);
  });

  it("uses the LOD0 ground transform for later levels", () => {
    const aligned = alignLodToBaseNormalization(
      geometry([primitive("body", 1)], [2, 0, 0]),
      geometry([primitive("body", 2)], [1, 0, 0]),
    );
    expect(aligned.parts[0].normalization).toMatchObject({
      mode: "ground-center-from-lod0",
      translation: [1, 0, 0],
    });
    expect(aligned.parts[0].primitives[0].positions[0]).toBe(-1);
    expect(aligned.parts[0].bounds.min).toEqual([-1, 0, 0]);
  });

  it("rejects identity drift, fake LODs, unmatched drops, and non-decreasing totals", () => {
    const source = meshSource();
    const base = geometry([primitive("body", 4), primitive("bolt", 1)]);
    expect(() =>
      reconcileResearchCourtyardLods(source, [
        base,
        geometry([primitive("renamed", 2), primitive("bolt", 1)]),
        geometry([primitive("body", 1)]),
      ]),
    ).toThrow(/identity changed/);
    expect(() =>
      reconcileResearchCourtyardLods(source, [
        base,
        geometry([primitive("body", 4, 1), primitive("bolt", 1)]),
        geometry([primitive("body", 1)]),
      ]),
    ).toThrow(/without reducing/);
    expect(() =>
      reconcileResearchCourtyardLods(
        { ...source, lod: { ...source.lod, lod2DropNodeNames: ["missing"] } },
        [
          base,
          geometry([primitive("body", 2), primitive("bolt", 1)]),
          geometry([primitive("body", 1)]),
        ],
      ),
    ).toThrow(/matched no primitive/);
    expect(() =>
      reconcileResearchCourtyardLods(source, [
        base,
        geometry([primitive("body", 4), primitive("bolt", 1)]),
        geometry([primitive("body", 1)]),
      ]),
    ).toThrow(/strict total triangle reduction/);
  });
});
