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
        screenError: 4,
        indirect: { instanceCount: 1, firstInstance: 0 },
        ...geometry(0.25, 0.25, 1),
      },
      {
        meshIndex: 0,
        lod: 0,
        materialIndex: 0,
        screenError: 0.25,
        indirect: { instanceCount: 1, firstInstance: 0 },
        ...geometry(0.5, 1, 3),
      },
      {
        meshIndex: 0,
        lod: 1,
        materialIndex: 0,
        screenError: 1,
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
    expect(lods.map((lod: { indirectOffset: number }) => lod.indirectOffset)).toEqual([0, 32, 64]);
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
