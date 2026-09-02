import { describe, expect, it } from "vitest";
import {
  PACKED_SCENE_V2_INDEXED_INDIRECT_LAYOUT as indirect,
  PACKED_SCENE_V2_INSTANCE_LAYOUT as instance,
  PACKED_SCENE_V2_MATERIAL_LAYOUT as material,
  PACKED_SCENE_V2_VERTEX_LAYOUT as vertex,
  parsePackedSceneV2,
} from "../src/demos/research-courtyard/packed-scene-v2";
import {
  RuntimeManifestV2ValidationError,
  assertRuntimeManifestV2MatchesPack,
  parseResearchCourtyardRuntimeManifestV2,
} from "../src/demos/research-courtyard/runtime-manifest-v2";

const hash = "b".repeat(64);
const resource = (uri: string, bytes: number) => ({ uri, bytes, sha256: hash });
const layout = (strideBytes: number, attributes: readonly unknown[]) => ({
  strideBytes,
  attributes,
});
const transform = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

function minimalPack(): Record<string, unknown> {
  return {
    format: "graphics-portfolio-packed-scene",
    version: 2,
    placeholder: false,
    coordinateSystem: "right-handed-y-up-meters",
    indexFormat: "uint32",
    vertexLayout: layout(32, vertex),
    materialLayout: layout(64, material),
    instanceLayout: layout(128, instance),
    indirectCommandLayout: layout(32, indirect),
    meshes: [
      {
        id: "crate",
        lodPolicy: "simplified",
        lods: [
          {
            baseVertex: 0,
            firstIndex: 0,
            indexCount: 12,
            vertexCount: 8,
            screenError: 0,
          },
          {
            baseVertex: 8,
            firstIndex: 12,
            indexCount: 6,
            vertexCount: 6,
            screenError: 1,
          },
          {
            baseVertex: 14,
            firstIndex: 18,
            indexCount: 3,
            vertexCount: 3,
            screenError: 2,
          },
        ],
      },
    ],
    materials: [
      {
        id: "concrete",
        role: "default",
        alphaMode: "OPAQUE",
        doubleSided: false,
        baseColor: [1, 1, 1, 1],
        emissive: [0, 0, 0],
        metallic: 0,
        roughness: 1,
        alphaCutoff: 0,
        normalScale: 1,
        textureIndices: { baseColor: 0, normal: 0, orm: 0 },
        flags: 0,
      },
    ],
    instances: [
      {
        currentTransform: transform,
        previousTransform: transform,
        materialIndex: 0,
        meshIndex: 0,
        flags: 0,
        worldSphere: [0, 0, 0, 1],
      },
    ],
    renderPasses: { deferredOpaque: [0], alphaMaskForward: [] },
    transport: {
      vertices: { uri: "courtyard/vertices.bin", bytes: 17 * 32 },
      indices: { uri: "courtyard/indices.bin", bytes: 21 * 4 },
      materials: { uri: "courtyard/materials.bin", bytes: 64 },
      instances: { uri: "courtyard/instances.bin", bytes: 128 },
      indirect: { uri: "courtyard/indirect.bin", bytes: 96 },
      textures: [
        {
          id: "base",
          colorSpace: "srgb",
          ktx2: "textures/base.ktx2",
          webp: "textures/base.webp",
        },
      ],
    },
  };
}

function manifest(): Record<string, unknown> {
  return {
    version: 2,
    sourceSetSha256: hash,
    recipeSha256: hash,
    toolchainLockSha256: hash,
    pack: resource("courtyard/research-courtyard.pack.json", 123),
    buffers: {
      vertices: resource("courtyard/vertices.bin", 544),
      indices: resource("courtyard/indices.bin", 84),
      materials: resource("courtyard/materials.bin", 64),
      instances: resource("courtyard/instances.bin", 128),
      indirect: resource("courtyard/indirect.bin", 96),
    },
    textures: {
      base: {
        colorSpace: "srgb",
        ktx2: resource("textures/base.ktx2", 100),
        webp: resource("textures/base.webp", 80),
      },
    },
  };
}

describe("Research Courtyard Runtime Manifest v2", () => {
  it("binds source, recipe, toolchain, pack, buffers, and texture transports", () => {
    const runtime = parseResearchCourtyardRuntimeManifestV2(manifest());
    expect(() =>
      assertRuntimeManifestV2MatchesPack(runtime, parsePackedSceneV2(minimalPack())),
    ).not.toThrow();
    expect(runtime.buffers).toHaveProperty("indirect");
  });

  it("rejects unsafe URIs and incomplete digests", () => {
    const unsafe = manifest();
    ((unsafe.buffers as Record<string, unknown>).vertices as Record<string, unknown>).uri =
      "../outside.bin";
    expect(() => parseResearchCourtyardRuntimeManifestV2(unsafe)).toThrow("portable relative");

    const invalid = manifest();
    invalid.recipeSha256 = "not-a-digest";
    expect(() => parseResearchCourtyardRuntimeManifestV2(invalid)).toThrow(
      RuntimeManifestV2ValidationError,
    );
  });

  it("does not permit a manifest to describe a different payload", () => {
    const runtime = parseResearchCourtyardRuntimeManifestV2(manifest());
    runtime.buffers.indices.bytes = 4;
    const parsed = parsePackedSceneV2(minimalPack());
    expect(() => assertRuntimeManifestV2MatchesPack(runtime, parsed)).toThrow(
      "must match the Pack v2 transport",
    );

    const changedTexture = parseResearchCourtyardRuntimeManifestV2(manifest());
    changedTexture.textures.base.colorSpace = "linear";
    expect(() => assertRuntimeManifestV2MatchesPack(changedTexture, parsed)).toThrow(
      "must match the Pack v2 texture record",
    );
  });
});
