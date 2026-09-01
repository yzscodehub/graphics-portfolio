import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PACKED_SCENE_COORDINATE_SYSTEM,
  PackedSceneValidationError,
  parsePackedScene,
  selectPackedSceneTexture,
} from "../src/demos/research-courtyard/packed-scene";

function readPlaceholder(): unknown {
  return JSON.parse(
    readFileSync(
      path.join(process.cwd(), "public/assets/rendering/packs/research-courtyard.pack.json"),
      "utf8",
    ),
  ) as unknown;
}

function reviewedFixture(): Record<string, unknown> {
  return {
    format: "graphics-portfolio-packed-scene",
    version: 1,
    generator: "test",
    placeholder: false,
    notice: "reviewed fixture",
    coordinateSystem: PACKED_SCENE_COORDINATE_SYSTEM,
    vertexLayout: {
      strideBytes: 32,
      attributes: [
        { semantic: "POSITION", format: "float32x3", offsetBytes: 0 },
        { semantic: "NORMAL_OCT", format: "snorm16x2", offsetBytes: 12 },
        { semantic: "TANGENT", format: "snorm16x4", offsetBytes: 16 },
        { semantic: "TEXCOORD_0", format: "float16x2", offsetBytes: 24 },
        { semantic: "PADDING", format: "uint32", offsetBytes: 28 },
      ],
    },
    indexFormat: "uint32",
    materialLayout: {
      factors: ["baseColor", "metallic", "roughness"],
      textureIndex: "uint32",
      alphaModes: ["OPAQUE", "MASK"],
      doubleSided: "bool",
    },
    indirectCommand: { alignmentBytes: 32, firstInstance: 0 },
    meshes: [
      {
        id: "opaque",
        vertexCount: 4,
        indexCount: 6,
        baseVertex: 0,
        indexOffset: 0,
        bounds: { center: [0, 0, 0], radius: 1 },
        lod: { lod0Triangles: 2, lod1Triangles: 1, lod2Triangles: 1 },
      },
    ],
    materials: [{ id: "concrete", alphaMode: "OPAQUE", doubleSided: false }],
    instances: [
      { meshId: "opaque", material: "concrete", transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] },
    ],
    renderPasses: { deferredOpaque: ["opaque"], alphaMaskForward: [] },
    transport: {
      vertices: { uri: "scene.vertices.bin", byteLength: 128 },
      indices: { uri: "scene.indices.bin", byteLength: 24 },
      textures: [{ id: "concrete", ktx2: "concrete.ktx2", webpFallback: "concrete.webp" }],
    },
  };
}

describe("Research Courtyard Packed Scene contract", () => {
  it("returns preview-placeholder instead of promoting the published placeholder pack", () => {
    const first = parsePackedScene(readPlaceholder());
    const second = parsePackedScene(readPlaceholder());
    expect(first.readiness).toBe("preview-placeholder");
    expect(first).toEqual(second);
    expect(first.vertexLayout.strideBytes).toBe(32);
    expect(first.indirect).toEqual({ alignmentBytes: 32, firstInstance: 0 });
  });

  it("validates reviewed binary ranges and monotonic LODs", () => {
    const fixture = reviewedFixture();
    expect(parsePackedScene(fixture).readiness).toBe("reviewed");
    (fixture.meshes as Array<Record<string, unknown>>)[0].baseVertex = 5;
    expect(() => parsePackedScene(fixture)).toThrow(PackedSceneValidationError);
    (fixture.meshes as Array<Record<string, unknown>>)[0].baseVertex = 0;
    (fixture.meshes as Array<Record<string, unknown>>)[0].lod = {
      lod0Triangles: 1,
      lod1Triangles: 2,
      lod2Triangles: 1,
    };
    expect(() => parsePackedScene(fixture)).toThrow("must be monotonic");
  });

  it("rejects malformed vertex contracts and transforms", () => {
    const fixture = reviewedFixture();
    (
      (fixture.vertexLayout as Record<string, unknown>).attributes as Array<Record<string, unknown>>
    )[3].offsetBytes = 20;
    expect(() => parsePackedScene(fixture)).toThrow("fixed 32-byte layout");
    const transformFixture = reviewedFixture();
    (transformFixture.instances as Array<Record<string, unknown>>)[0].transform = [1, 0, 0];
    expect(() => parsePackedScene(transformFixture)).toThrow("3x4 transform");
  });

  it("keeps MASK materials out of deferred opaque and supports KTX2 then WebP selection", () => {
    const fixture = reviewedFixture();
    (fixture.materials as Array<Record<string, unknown>>)[0].alphaMode = "MASK";
    expect(() => parsePackedScene(fixture)).toThrow("MASK material must be in alphaMaskForward");
    (fixture.renderPasses as Record<string, unknown>).deferredOpaque = [];
    (fixture.renderPasses as Record<string, unknown>).alphaMaskForward = ["opaque"];
    expect(parsePackedScene(fixture).renderPasses.alphaMaskForward).toEqual(["opaque"]);
    const texture = { id: "brick", ktx2: "brick.ktx2", webpFallback: "brick.webp" };
    expect(selectPackedSceneTexture(texture, { ktx2: true })).toEqual({
      kind: "ktx2",
      uri: "brick.ktx2",
    });
    expect(selectPackedSceneTexture(texture, { ktx2: false })).toEqual({
      kind: "webp",
      uri: "brick.webp",
    });
    expect(
      selectPackedSceneTexture({ id: "none", ktx2: null, webpFallback: null }, { ktx2: true }),
    ).toEqual({ kind: "unavailable" });
  });
});
