import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  INDEXED_INDIRECT_STRIDE,
  INSTANCE_STRIDE,
  MATERIAL_STRIDE,
  VERTEX_STRIDE,
  encodeResearchCourtyardBinary,
  packFloat16,
  packOctSnorm16,
  packTangentSnorm16x4,
  unpackFloat16,
  unpackOctSnorm16,
  unpackTangentSnorm16x4,
  validateResearchCourtyardPackedBuffers,
} from "../scripts/assets/research-courtyard-binary.mjs";
import {
  PACKED_SCENE_V2_INDEXED_INDIRECT_LAYOUT,
  PACKED_SCENE_V2_INSTANCE_LAYOUT,
  PACKED_SCENE_V2_MATERIAL_LAYOUT,
  PACKED_SCENE_V2_VERTEX_LAYOUT,
  parsePackedSceneV2,
} from "../src/demos/research-courtyard/packed-scene-v2";

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

function geometry(z: number, scale: number, triangles: number) {
  const vertices = [
    {
      position: [scale, -2 * scale, z],
      normal: [0, 0, 1],
      tangent: [1, 0, 0, 1],
      uv: [0.5, 1],
    },
    {
      position: [-scale, -2 * scale, z],
      normal: [0, 0, 1],
      tangent: [1, 0, 0, 1],
      uv: [0, 1],
    },
    {
      position: [0, scale, z],
      normal: [0, 0, 1],
      tangent: [1, 0, 0, 1],
      uv: [0.5, 0],
    },
  ];
  return {
    vertices,
    indices: Array.from({ length: triangles }, () => [0, 1, 2]).flat(),
  };
}

function sourceScene() {
  return {
    textureCount: 3,
    materials: [
      {
        baseColor: [0.8, 0.5, 0.2, 1],
        emissive: [0, 0, 0],
        metallic: 0.3,
        roughness: 0.7,
        alphaCutoff: 0.5,
        normalScale: 1,
        baseColorTexture: 0,
        normalTexture: 1,
        ormTexture: 2,
        alphaMode: "MASK",
        doubleSided: true,
      },
    ],
    instances: [
      {
        meshIndex: 0,
        materialIndex: 0,
        transform: identity,
        previousTransform: identity,
        flags: 7,
        worldSphere: [0, 0, 0, 2],
      },
    ],
    primitives: [
      {
        meshIndex: 0,
        lod: 2,
        materialIndex: 0,
        relativeError: 4,
        instanceOffset: 0,
        indirect: { instanceCount: 1, firstInstance: 0 },
        ...geometry(0.25, 0.25, 1),
      },
      {
        meshIndex: 0,
        lod: 0,
        materialIndex: 0,
        relativeError: 0.25,
        instanceOffset: 0,
        indirect: { instanceCount: 1, firstInstance: 0 },
        ...geometry(0.5, 1, 3),
      },
      {
        meshIndex: 0,
        lod: 1,
        materialIndex: 0,
        relativeError: 1,
        instanceOffset: 0,
        indirect: { instanceCount: 1, firstInstance: 0 },
        ...geometry(0.375, 0.5, 2),
      },
    ],
  };
}

function digest(buffer: ArrayBuffer) {
  return createHash("sha256").update(new Uint8Array(buffer)).digest("hex");
}

describe("Research Courtyard deterministic binary encoder", () => {
  it("uses stable little-endian golden bytes for the first LOD0 vertex", () => {
    const encoded = encodeResearchCourtyardBinary(sourceScene());
    const firstVertex = Buffer.from(encoded.buffers.vertices.slice(0, VERTEX_STRIDE)).toString(
      "hex",
    );
    expect(firstVertex).toBe("0000803f000000c00000003f00000000ff7f00000000ff7f0038003c00000000");
    expect(encoded.buffers.vertices.byteLength).toBe(9 * VERTEX_STRIDE);
    expect(encoded.buffers.materials.byteLength).toBe(MATERIAL_STRIDE);
    expect(encoded.buffers.instances.byteLength).toBe(INSTANCE_STRIDE);
    expect(encoded.buffers.indirect.byteLength).toBe(3 * INDEXED_INDIRECT_STRIDE);
  });

  it("round-trips float16, oct normals, and tangent packing within tolerance", () => {
    for (const value of [0, -0, 0.1, -2.75, 0.3333, 65504])
      expect(unpackFloat16(packFloat16(value))).toBeCloseTo(value, 3);
    const normal = [0.25, -0.4, 0.881759604] as const;
    const decodedNormal = unpackOctSnorm16(packOctSnorm16(normal));
    const length = Math.hypot(...normal);
    const dot = decodedNormal.reduce(
      (sum, component, index) => sum + (component * normal[index]) / length,
      0,
    );
    expect(dot).toBeGreaterThan(0.9999);
    const tangent = unpackTangentSnorm16x4(packTangentSnorm16x4([1, 0.25, 0, -1]));
    expect(Math.hypot(tangent[0], tangent[1], tangent[2])).toBeCloseTo(1, 4);
    expect(tangent[3]).toBeCloseTo(-1, 4);
  });

  it("writes the exact Pack v2 material and instance layouts", () => {
    const encoded = encodeResearchCourtyardBinary(sourceScene());
    const material = new DataView(encoded.buffers.materials);
    const instance = new DataView(encoded.buffers.instances);
    expect(material.getUint32(44, true)).toBe(3);
    expect(material.getUint32(48, true)).toBe(0);
    expect(material.getUint32(52, true)).toBe(1);
    expect(material.getUint32(56, true)).toBe(2);
    for (let offset = 60; offset < 64; offset += 1) expect(material.getUint8(offset)).toBe(0);
    expect(instance.getUint32(96, true)).toBe(0);
    expect(instance.getUint32(100, true)).toBe(0);
    expect(instance.getUint32(104, true)).toBe(7);
    expect(instance.getFloat32(120, true)).toBe(2);
    for (let offset = 124; offset < 128; offset += 1) expect(instance.getUint8(offset)).toBe(0);
  });

  it("emits three canonical LOD records and matching indirect commands", () => {
    const encoded = encodeResearchCourtyardBinary(sourceScene());
    expect(encoded.metadata).toMatchObject({
      version: 2,
      endian: "little",
      layout: {
        vertexStride: 32,
        indexStride: 4,
        materialStride: 64,
        instanceStride: 128,
        indexedIndirectStride: 32,
      },
      counts: {
        vertices: 9,
        indices: 18,
        materials: 1,
        instances: 1,
        meshes: 1,
        indexedIndirectCommands: 3,
      },
    });
    const lods = encoded.metadata.meshes[0].lods;
    expect(lods.map((lod: { lod: number }) => lod.lod)).toEqual([0, 1, 2]);
    expect(lods.map((lod: { indirectByteOffset: number }) => lod.indirectByteOffset)).toEqual([
      0, 32, 64,
    ]);
    expect(validateResearchCourtyardPackedBuffers(encoded)).toMatchObject({
      vertices: 9,
      indices: 18,
      materials: 1,
      instances: 1,
      commands: 3,
    });
  });

  it("is byte-identical across repeated encodes", () => {
    const left = encodeResearchCourtyardBinary(sourceScene());
    const right = encodeResearchCourtyardBinary(sourceScene());
    for (const name of ["vertices", "indices", "materials", "instances", "indirect"] as const) {
      expect(digest(left.buffers[name])).toBe(digest(right.buffers[name]));
      expect(new Uint8Array(left.buffers[name])).toEqual(new Uint8Array(right.buffers[name]));
    }
    expect(left.metadata).toEqual(right.metadata);
  });

  it("encodes an explicit zero-count LOD2 cull without indirect-first-instance", () => {
    const scene = sourceScene();
    for (const primitive of scene.primitives)
      Object.assign(primitive, {
        lodPolicy: "culled-at-lod2",
        state: "draw",
      });
    const lod2 = scene.primitives.find((primitive) => primitive.lod === 2);
    if (!lod2) throw new Error("Expected fixture LOD2.");
    Object.assign(lod2, {
      state: "culled",
      vertices: [],
      indices: [],
      indirect: { instanceCount: 0, firstInstance: 0 },
    });
    const encoded = encodeResearchCourtyardBinary(scene);
    expect(encoded.metadata.meshes[0].lods[2]).toMatchObject({
      state: "culled",
      indexCount: 0,
      vertexCount: 0,
      instanceOffset: 0,
      instanceCount: 0,
      indirectByteOffset: 64,
    });
    const command = new DataView(encoded.buffers.indirect, 64, 32);
    expect(command.getUint32(0, true)).toBe(0);
    expect(command.getUint32(4, true)).toBe(0);
    expect(command.getUint32(16, true)).toBe(0);
  });

  it("feeds encoder metadata directly into the strict Pack v2 parser", () => {
    const encoded = encodeResearchCourtyardBinary(sourceScene());
    const meshes = encoded.metadata.meshes.map(
      (
        mesh: {
          lodPolicy: string;
          lods: Array<{
            state: string;
            baseVertex: number;
            firstIndex: number;
            indexCount: number;
            vertexCount: number;
            relativeError: number;
            indirectByteOffset: number;
            instanceOffset: number;
            instanceCount: number;
          }>;
        },
        index: number,
      ) => ({
        id: `mesh-${index}`,
        lodPolicy: mesh.lodPolicy,
        lods: mesh.lods.map((lod) => ({
          state: lod.state,
          baseVertex: lod.baseVertex,
          firstIndex: lod.firstIndex,
          indexCount: lod.indexCount,
          vertexCount: lod.vertexCount,
          relativeError: lod.relativeError,
          indirectByteOffset: lod.indirectByteOffset,
          instanceOffset: lod.instanceOffset,
          instanceCount: lod.instanceCount,
        })),
      }),
    );
    const parsed = parsePackedSceneV2({
      format: "graphics-portfolio-packed-scene",
      version: 2,
      placeholder: false,
      coordinateSystem: "right-handed-y-up-meters",
      indexFormat: "uint32",
      vertexLayout: { strideBytes: 32, attributes: PACKED_SCENE_V2_VERTEX_LAYOUT },
      materialLayout: {
        strideBytes: 64,
        attributes: PACKED_SCENE_V2_MATERIAL_LAYOUT,
      },
      instanceLayout: {
        strideBytes: 128,
        attributes: PACKED_SCENE_V2_INSTANCE_LAYOUT,
      },
      indirectCommandLayout: {
        strideBytes: 32,
        attributes: PACKED_SCENE_V2_INDEXED_INDIRECT_LAYOUT,
      },
      meshes,
      materials: [
        {
          id: "fixture-mask",
          role: "fence",
          alphaMode: "MASK",
          doubleSided: true,
          baseColor: [0.8, 0.5, 0.2, 1],
          emissive: [0, 0, 0],
          metallic: 0.3,
          roughness: 0.7,
          alphaCutoff: 0.5,
          normalScale: 1,
          textureIndices: { baseColor: 0, normal: 1, orm: 2 },
          flags: 3,
        },
      ],
      instances: [
        {
          currentTransform: identity,
          previousTransform: identity,
          materialIndex: 0,
          meshIndex: 0,
          flags: 7,
          worldSphere: [0, 0, 0, 2],
        },
      ],
      renderPasses: { deferredOpaque: [], alphaMaskForward: [0] },
      transport: {
        vertices: {
          uri: "courtyard/vertices.bin",
          bytes: encoded.buffers.vertices.byteLength,
        },
        indices: {
          uri: "courtyard/indices.bin",
          bytes: encoded.buffers.indices.byteLength,
        },
        materials: {
          uri: "courtyard/materials.bin",
          bytes: encoded.buffers.materials.byteLength,
        },
        instances: {
          uri: "courtyard/instances.bin",
          bytes: encoded.buffers.instances.byteLength,
        },
        indirect: {
          uri: "courtyard/indirect.bin",
          bytes: encoded.buffers.indirect.byteLength,
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
    });
    expect(parsed.meshes[0].lods.map((lod) => lod.indirectByteOffset)).toEqual([0, 32, 64]);
  });

  it.each([
    [
      "non-finite vertex",
      (scene: ReturnType<typeof sourceScene>) => {
        scene.primitives[0].vertices[0].position[0] = Number.NaN;
      },
    ],
    [
      "local index range",
      (scene: ReturnType<typeof sourceScene>) => {
        scene.primitives[0].indices[2] = 99;
      },
    ],
    [
      "missing LOD",
      (scene: ReturnType<typeof sourceScene>) => {
        scene.primitives.pop();
      },
    ],
    [
      "primitive material range",
      (scene: ReturnType<typeof sourceScene>) => {
        scene.primitives[0].materialIndex = 1;
      },
    ],
    [
      "instance material range",
      (scene: ReturnType<typeof sourceScene>) => {
        scene.instances[0].materialIndex = 1;
      },
    ],
    [
      "zero sphere radius",
      (scene: ReturnType<typeof sourceScene>) => {
        scene.instances[0].worldSphere[3] = 0;
      },
    ],
    [
      "unsupported BLEND alpha",
      (scene: ReturnType<typeof sourceScene>) => {
        scene.materials[0].alphaMode = "BLEND";
      },
    ],
    [
      "fake LOD counts",
      (scene: ReturnType<typeof sourceScene>) => {
        scene.primitives[1].indices = [...scene.primitives[0].indices];
      },
    ],
  ])("fails closed for %s", (_name, mutate) => {
    const scene = sourceScene();
    mutate(scene);
    expect(() => encodeResearchCourtyardBinary(scene)).toThrow(/Research Courtyard binary:/);
  });

  it("rejects corruption in declared LOD ranges", () => {
    const encoded = encodeResearchCourtyardBinary(sourceScene());
    new DataView(encoded.buffers.indices).setUint32(0, 99, true);
    expect(() => validateResearchCourtyardPackedBuffers(encoded)).toThrow(
      /local index exceeds its LOD vertex range/,
    );
  });
});
