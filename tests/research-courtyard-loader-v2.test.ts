import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  encodeResearchCourtyardBinary,
  NO_TEXTURE,
} from "../scripts/assets/research-courtyard-binary.mjs";
import { compressResearchCourtyardBuffers } from "../scripts/assets/research-courtyard-meshopt.mjs";
import {
  ResearchCourtyardV2Loader,
  type ResearchCourtyardV2Fetch,
} from "../src/demos/research-courtyard/loader-v2";
import {
  PACKED_SCENE_V2_INDEXED_INDIRECT_LAYOUT,
  PACKED_SCENE_V2_INSTANCE_LAYOUT,
  PACKED_SCENE_V2_MATERIAL_LAYOUT,
  PACKED_SCENE_V2_VERTEX_LAYOUT,
} from "../src/demos/research-courtyard/packed-scene-v2";

const baseUrl = "https://portfolio.test/assets/rendering/research-courtyard/";
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

function geometry(scale: number, triangles: number) {
  const vertices = [
    {
      position: [scale, 0, 0],
      normal: [0, 0, 1],
      tangent: [1, 0, 0, 1],
      uv: [0, 0],
    },
    {
      position: [0, scale, 0],
      normal: [0, 0, 1],
      tangent: [1, 0, 0, 1],
      uv: [1, 0],
    },
    {
      position: [0, 0, scale],
      normal: [0, 0, 1],
      tangent: [1, 0, 0, 1],
      uv: [0, 1],
    },
  ];
  return {
    vertices,
    indices: Array.from({ length: triangles }, () => [0, 1, 2]).flat(),
  };
}

function binaryInput() {
  return {
    textureCount: 0,
    materials: [
      {
        baseColor: [1, 1, 1, 1],
        emissive: [0, 0, 0],
        metallic: 0,
        roughness: 1,
        alphaCutoff: 0.5,
        normalScale: 1,
        baseColorTexture: null,
        normalTexture: null,
        ormTexture: null,
        alphaMode: "OPAQUE",
        doubleSided: false,
      },
    ],
    instances: [
      {
        meshIndex: 0,
        materialIndex: 0,
        currentTransform: identity,
        previousTransform: identity,
        flags: 0,
        worldSphere: [0, 0, 0, 1],
      },
    ],
    primitives: [
      {
        meshIndex: 0,
        lod: 0,
        state: "draw",
        lodPolicy: "simplified",
        materialIndex: 0,
        relativeError: 0,
        instanceOffset: 0,
        indirect: { instanceCount: 1, firstInstance: 0 },
        ...geometry(1, 3),
      },
      {
        meshIndex: 0,
        lod: 1,
        state: "draw",
        lodPolicy: "simplified",
        materialIndex: 0,
        relativeError: 0.01,
        instanceOffset: 0,
        indirect: { instanceCount: 1, firstInstance: 0 },
        ...geometry(0.5, 2),
      },
      {
        meshIndex: 0,
        lod: 2,
        state: "draw",
        lodPolicy: "simplified",
        materialIndex: 0,
        relativeError: 0.05,
        instanceOffset: 0,
        indirect: { instanceCount: 1, firstInstance: 0 },
        ...geometry(0.25, 1),
      },
    ],
  };
}

function digest(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function bytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value));
}

function resource(uri: string, value: Uint8Array) {
  return { uri, bytes: value.byteLength, sha256: digest(value) };
}

async function fixture() {
  const encoded = encodeResearchCourtyardBinary(binaryInput());
  const compressed = await compressResearchCourtyardBuffers(encoded.buffers);
  const names = ["vertices", "indices", "materials", "instances", "indirect"] as const;
  type BufferName = (typeof names)[number];
  type CompressionRecord = {
    codec: string;
    codecVersion: number;
    encoderLevel: number | null;
    mode: string;
    count: number;
    stride: number;
    decodedBytes: number;
    encodedBytes: number;
    encodedSha256: string;
    sourceSha256: string;
    decodedSha256: string;
    parity: string;
  };
  const compressedTyped = compressed as unknown as {
    buffers: Record<BufferName, Uint8Array>;
    manifest: { records: Record<BufferName, CompressionRecord> };
  };
  const transport = Object.fromEntries(
    names.map((name) => {
      const record = compressedTyped.manifest.records[name];
      return [
        name,
        {
          uri: `courtyard/${name}.meshopt`,
          bytes: record.decodedBytes,
          encoding: {
            codec: record.codec,
            codecVersion: record.codecVersion,
            encoderLevel: record.encoderLevel,
            mode: record.mode,
            count: record.count,
            stride: record.stride,
            encodedBytes: record.encodedBytes,
            encodedSha256: record.encodedSha256,
            sourceSha256: record.sourceSha256,
            decodedSha256: record.decodedSha256,
            parity: record.parity,
          },
        },
      ];
    }),
  ) as unknown as Record<BufferName, Record<string, unknown>>;
  const pack = {
    format: "graphics-portfolio-packed-scene",
    version: 2,
    placeholder: false,
    coordinateSystem: "right-handed-y-up-meters",
    indexFormat: "uint32",
    vertexLayout: {
      strideBytes: 32,
      attributes: PACKED_SCENE_V2_VERTEX_LAYOUT,
    },
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
    meshes: encoded.metadata.meshes.map(
      (mesh: { lodPolicy: string; lods: Array<Record<string, unknown>> }) => ({
        id: "fixture",
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
    ),
    materials: [
      {
        id: "fixture",
        role: "default",
        alphaMode: "OPAQUE",
        doubleSided: false,
        baseColor: [1, 1, 1, 1],
        emissive: [0, 0, 0],
        metallic: 0,
        roughness: 1,
        alphaCutoff: 0.5,
        normalScale: 1,
        textureIndices: {
          baseColor: NO_TEXTURE,
          normal: NO_TEXTURE,
          orm: NO_TEXTURE,
        },
        flags: 0,
      },
    ],
    instances: [
      {
        id: "fixture-0",
        currentTransform: identity,
        previousTransform: identity,
        materialIndex: 0,
        meshIndex: 0,
        flags: 0,
        worldSphere: [0, 0, 0, 1],
        animation: null,
      },
    ],
    renderPasses: { deferredOpaque: [0], alphaMaskForward: [] },
    transport: { ...transport, textures: [] },
  };
  const packBytes = bytes(pack);
  const environmentBytes = bytes({
    format: "graphics-portfolio-diffuse-irradiance-sh9",
    version: 1,
    source: { id: "fixture" },
    diffuseSh: {
      basis: "real-sh-y-up-v1",
      convolution: "lambertian-cosine-v1",
      coefficients: Array.from({ length: 9 }, (_, index) => ({
        index,
        l: index === 0 ? 0 : index < 4 ? 1 : 2,
        m: index === 0 ? 0 : index < 4 ? index - 2 : index - 6,
        rgb: [1, 1, 1],
      })),
    },
    specularIbl: false,
    runtimeHdr: false,
  });
  const files = new Map<string, Uint8Array>();
  const add = (uri: string, value: Uint8Array) => {
    files.set(new URL(uri, baseUrl).href, value);
    return resource(uri, value);
  };
  const runtime = {
    version: 2,
    sourceSetSha256: "a".repeat(64),
    recipeSha256: "b".repeat(64),
    toolchainLockSha256: "c".repeat(64),
    pack: add("courtyard/research-courtyard.pack.json", packBytes),
    buffers: Object.fromEntries(
      names.map((name) => [name, add(`courtyard/${name}.meshopt`, compressedTyped.buffers[name])]),
    ),
    textures: {},
    transcoders: {
      ktx: {
        version: "4.4.2",
        script: add("transcoders/ktx/libktx_read.js", new TextEncoder().encode("fixture script")),
        wasm: add("transcoders/ktx/libktx_read.wasm", new Uint8Array([0, 97, 115, 109])),
      },
    },
    environment: {
      diffuseSh: add("courtyard/diffuse-sh9.json", environmentBytes),
      reviewPreview: null,
      specularIbl: false,
      runtimeHdr: false,
    },
  };
  const runtimeBytes = bytes(runtime);
  const manifest = add("runtime.manifest.json", runtimeBytes);
  const fetch: ResearchCourtyardV2Fetch = async (input, init) => {
    if (init?.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    const value = files.get(input);
    return value
      ? new Response(value.slice(), { status: 200 })
      : new Response("missing", { status: 404 });
  };
  return { files, fetch, manifest, encoded };
}

describe("Research Courtyard v2 browser loader", () => {
  it("verifies, decodes, and disposes all five buffers plus diffuse SH9", async () => {
    const input = await fixture();
    const loader = new ResearchCourtyardV2Loader();
    const result = await loader.load({
      baseUrl,
      manifest: input.manifest,
      fetch: input.fetch,
    });
    expect(result).toMatchObject({ readiness: "cpu-payload", generation: 1 });
    const payload = result.payload;
    if (!payload) throw new Error("Expected a decoded v2 payload.");
    expect(payload.pack.meshes).toHaveLength(1);
    expect(payload.environment).toMatchObject({
      basis: "real-sh-y-up-v1",
      convolution: "lambertian-cosine-v1",
    });
    expect(payload.environment.coefficients).toHaveLength(9);
    expect(payload.buffers.vertices.byteLength).toBe(input.encoded.buffers.vertices.byteLength);
    expect(payload.buffers.indices.byteLength).toBe(input.encoded.buffers.indices.byteLength);
    loader.dispose();
    expect(payload.buffers.vertices.byteLength).toBe(0);
    expect(payload.buffers.indirect.byteLength).toBe(0);
  });

  it("fails closed when an encoded resource changes without silently falling back", async () => {
    const input = await fixture();
    const uri = new URL("courtyard/vertices.meshopt", baseUrl).href;
    const changed = input.files.get(uri)?.slice();
    if (!changed) throw new Error("Expected the vertices fixture.");
    changed[changed.length - 1] ^= 1;
    input.files.set(uri, changed);
    const result = await new ResearchCourtyardV2Loader().load({
      baseUrl,
      manifest: input.manifest,
      fetch: input.fetch,
    });
    expect(result.readiness).toBe("failed");
    expect(result.reason).toMatch(/SHA-256/);
    expect(result.payload).toBeUndefined();
  });

  it("disposes superseded payloads and preserves abort semantics", async () => {
    const input = await fixture();
    const loader = new ResearchCourtyardV2Loader();
    const first = await loader.load({
      baseUrl,
      manifest: input.manifest,
      fetch: input.fetch,
    });
    const firstPayload = first.payload;
    if (!firstPayload) throw new Error("Expected first payload.");
    const second = await loader.load({
      baseUrl,
      manifest: input.manifest,
      fetch: input.fetch,
    });
    expect(second).toMatchObject({ readiness: "cpu-payload", generation: 2 });
    expect(firstPayload.buffers.vertices.byteLength).toBe(0);

    const controller = new AbortController();
    controller.abort(new DOMException("stop", "AbortError"));
    await expect(
      loader.load({
        baseUrl,
        manifest: input.manifest,
        fetch: input.fetch,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
