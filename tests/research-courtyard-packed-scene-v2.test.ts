import { describe, expect, it } from "vitest";
import {
  PACKED_SCENE_V2_INDEXED_INDIRECT_LAYOUT as indirect,
  PACKED_SCENE_V2_INSTANCE_LAYOUT as instance,
  PACKED_SCENE_V2_MATERIAL_LAYOUT as material,
  PACKED_SCENE_V2_VERTEX_LAYOUT as vertex,
  PackedSceneV2ValidationError,
  isPortableResourceUri,
  parsePackedSceneV2,
} from "../src/demos/research-courtyard/packed-scene-v2";

const layout = (strideBytes: number, attributes: readonly unknown[]) => ({
  strideBytes,
  attributes,
});
const transform = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

function pack(fence = false): Record<string, unknown> {
  const meshes = [
    {
      id: "crate",
      lodPolicy: "simplified",
      lods: [
        {
          state: "draw",
          baseVertex: 0,
          firstIndex: 0,
          indexCount: 12,
          vertexCount: 8,
          relativeError: 0,
          indirectByteOffset: 0,
          instanceOffset: 0,
          instanceCount: 1,
        },
        {
          state: "draw",
          baseVertex: 8,
          firstIndex: 12,
          indexCount: 6,
          vertexCount: 6,
          relativeError: 1,
          indirectByteOffset: 32,
          instanceOffset: 0,
          instanceCount: 1,
        },
        {
          state: "draw",
          baseVertex: 14,
          firstIndex: 18,
          indexCount: 3,
          vertexCount: 3,
          relativeError: 2,
          indirectByteOffset: 64,
          instanceOffset: 0,
          instanceCount: 1,
        },
      ],
    },
  ];
  const materials = [
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
      textureIndices: { baseColor: 0, normal: 1, orm: 2 },
      flags: 0,
    },
  ];
  const instances = [
    {
      currentTransform: transform,
      previousTransform: transform,
      materialIndex: 0,
      meshIndex: 0,
      flags: 0,
      worldSphere: [0, 0, 0, 1],
    },
  ];
  if (fence) {
    meshes.push({
      id: "fence",
      lodPolicy: "simplified",
      lods: [
        {
          state: "draw",
          baseVertex: 17,
          firstIndex: 21,
          indexCount: 12,
          vertexCount: 8,
          relativeError: 0,
          indirectByteOffset: 96,
          instanceOffset: 1,
          instanceCount: 1,
        },
        {
          state: "draw",
          baseVertex: 25,
          firstIndex: 33,
          indexCount: 6,
          vertexCount: 6,
          relativeError: 1,
          indirectByteOffset: 128,
          instanceOffset: 1,
          instanceCount: 1,
        },
        {
          state: "draw",
          baseVertex: 31,
          firstIndex: 39,
          indexCount: 3,
          vertexCount: 3,
          relativeError: 2,
          indirectByteOffset: 160,
          instanceOffset: 1,
          instanceCount: 1,
        },
      ],
    });
    materials.push({
      id: "chainlink",
      role: "fence",
      alphaMode: "MASK",
      doubleSided: true,
      baseColor: [1, 1, 1, 1],
      emissive: [0, 0, 0],
      metallic: 0,
      roughness: 1,
      alphaCutoff: 0.5,
      normalScale: 1,
      textureIndices: { baseColor: 0, normal: 1, orm: 2 },
      flags: 3,
    });
    instances.push({
      ...instances[0],
      materialIndex: 1,
      meshIndex: 1,
    });
  }
  const meshCount = meshes.length;
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
    meshes,
    materials,
    instances,
    renderPasses: {
      deferredOpaque: [0],
      alphaMaskForward: fence ? [1] : [],
    },
    transport: {
      vertices: {
        uri: "courtyard/vertices.bin",
        bytes: (fence ? 34 : 17) * 32,
      },
      indices: {
        uri: "courtyard/indices.bin",
        bytes: (fence ? 42 : 21) * 4,
      },
      materials: {
        uri: "courtyard/materials.bin",
        bytes: materials.length * 64,
      },
      instances: {
        uri: "courtyard/instances.bin",
        bytes: instances.length * 128,
      },
      indirect: {
        uri: "courtyard/indirect.bin",
        bytes: meshCount * 3 * 32,
      },
      textures: [
        {
          id: "base",
          colorSpace: "srgb",
          ktx2: "textures/base.ktx2",
          webp: "textures/base.webp",
        },
        {
          id: "normal",
          colorSpace: "linear",
          ktx2: "textures/normal.ktx2",
          webp: "textures/normal.webp",
        },
        {
          id: "orm",
          colorSpace: "linear",
          ktx2: "textures/orm.ktx2",
          webp: "textures/orm.webp",
        },
      ],
    },
  };
}

describe("Research Courtyard Pack v2", () => {
  it("accepts exact layouts, real LOD ranges, transport, and fence routing", () => {
    const parsed = parsePackedSceneV2(pack(true));
    expect(parsed.transport.indirect.bytes).toBe(192);
    expect(parsed.materials[1]).toMatchObject({
      role: "fence",
      flags: 3,
      alphaCutoff: 0.5,
    });
    expect(parsed.renderPasses).toEqual({
      deferredOpaque: [0],
      alphaMaskForward: [1],
    });
  });

  it("allows trivial geometry to declare preserved LODs without fake reduction", () => {
    const preserved = pack();
    const mesh = (preserved.meshes as Array<Record<string, unknown>>)[0];
    mesh.lodPolicy = "preserved";
    mesh.lods = [0, 1, 2].map((lod) => ({
      state: "draw",
      baseVertex: lod * 3,
      firstIndex: lod * 3,
      indexCount: 3,
      vertexCount: 3,
      relativeError: 0,
      indirectByteOffset: lod * 32,
      instanceOffset: 0,
      instanceCount: 1,
    }));
    const transport = preserved.transport as Record<string, unknown>;
    (transport.vertices as Record<string, unknown>).bytes = 9 * 32;
    (transport.indices as Record<string, unknown>).bytes = 9 * 4;
    expect(parsePackedSceneV2(preserved).meshes[0]).toMatchObject({
      lodPolicy: "preserved",
    });
  });

  it("represents a recipe-dropped drawable as a zero-count LOD2 command", () => {
    const culled = pack();
    const mesh = (culled.meshes as Array<Record<string, unknown>>)[0];
    mesh.lodPolicy = "culled-at-lod2";
    const lod2 = (mesh.lods as Array<Record<string, unknown>>)[2];
    Object.assign(lod2, {
      state: "culled",
      baseVertex: 14,
      firstIndex: 18,
      indexCount: 0,
      vertexCount: 0,
      instanceCount: 0,
    });
    const transport = culled.transport as Record<string, unknown>;
    (transport.vertices as Record<string, unknown>).bytes = 14 * 32;
    (transport.indices as Record<string, unknown>).bytes = 18 * 4;
    expect(parsePackedSceneV2(culled).meshes[0]).toMatchObject({
      lodPolicy: "culled-at-lod2",
      lods: [{ state: "draw" }, { state: "draw" }, { state: "culled" }],
    });
  });

  it("rejects fake LODs, misaligned payloads, and invalid references", () => {
    const fake = pack();
    (
      (fake.meshes as Array<Record<string, unknown>>)[0].lods as Array<Record<string, unknown>>
    )[1].indexCount = 12;
    expect(() => parsePackedSceneV2(fake)).toThrow("real, strictly decreasing");

    const misaligned = pack();
    ((misaligned.transport as Record<string, unknown>).materials as Record<string, unknown>).bytes =
      65;
    expect(() => parsePackedSceneV2(misaligned)).toThrow("aligned to 64 bytes");

    const invalid = pack();
    (invalid.instances as Array<Record<string, unknown>>)[0].meshIndex = 4;
    expect(() => parsePackedSceneV2(invalid)).toThrow(PackedSceneV2ValidationError);
  });

  it("keeps the fence exclusively in alpha-mask forward", () => {
    const badPass = pack(true);
    (badPass.renderPasses as Record<string, unknown>).deferredOpaque = [0, 1];
    (badPass.renderPasses as Record<string, unknown>).alphaMaskForward = [];
    expect(() => parsePackedSceneV2(badPass)).toThrow("material alpha mode");

    const badCutoff = pack(true);
    (badCutoff.materials as Array<Record<string, unknown>>)[1].alphaCutoff = 0.4;
    expect(() => parsePackedSceneV2(badCutoff)).toThrow("fence must be MASK");
  });

  it("accepts only portable asset URIs", () => {
    expect(isPortableResourceUri("courtyard/vertices.bin")).toBe(true);
    [
      "../vertices.bin",
      "/vertices.bin",
      "textures\\base.ktx2",
      "https://cdn.example/base.ktx2",
    ].forEach((uri) => expect(isPortableResourceUri(uri)).toBe(false));
  });
});
