import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  ResearchCourtyardRuntimeLoader,
  attachCourtyardPayload,
  type HashedResource,
  type ResearchCourtyardLoadOptions,
} from "../src/demos/research-courtyard/loader";
import { PACKED_SCENE_COORDINATE_SYSTEM } from "../src/demos/research-courtyard/packed-scene";

interface Fixture {
  options: ResearchCourtyardLoadOptions;
  responses: Map<string, Response>;
}

function bytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

function hash(buffer: ArrayBuffer): string {
  return createHash("sha256").update(new Uint8Array(buffer)).digest("hex");
}

function resource(uri: string, buffer: ArrayBuffer): HashedResource {
  return { uri, byteLength: buffer.byteLength, sha256: hash(buffer) };
}

function scene(placeholder = false, textured = false): Record<string, unknown> {
  return {
    format: "graphics-portfolio-packed-scene",
    version: 1,
    generator: "test",
    placeholder,
    notice: placeholder ? "placeholder" : "reviewed fixture",
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
        id: "floor",
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
      { meshId: "floor", material: "concrete", transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] },
    ],
    renderPasses: { deferredOpaque: ["floor"], alphaMaskForward: [] },
    transport: placeholder
      ? undefined
      : {
          vertices: { uri: "vertices.bin", byteLength: 128 },
          indices: { uri: "indices.bin", byteLength: 24 },
          textures: textured
            ? [{ id: "concrete", ktx2: "concrete.ktx2", webpFallback: "concrete.webp" }]
            : [],
        },
  };
}

async function fixture(
  options: { placeholder?: boolean; textured?: boolean } = {},
): Promise<Fixture> {
  const baseUrl = "/graphics-portfolio/";
  const sceneBytes = bytes(JSON.stringify(scene(options.placeholder, options.textured)));
  const vertices = new ArrayBuffer(128);
  const indices = new ArrayBuffer(24);
  const material = bytes("material");
  const ktx2 = bytes("ktx2");
  const webp = bytes("webp");
  const runtime = {
    version: 1,
    scene: resource("scene.json", sceneBytes),
    vertices: options.placeholder ? null : resource("vertices.bin", vertices),
    indices: options.placeholder ? null : resource("indices.bin", indices),
    material: options.placeholder ? null : resource("material.bin", material),
    textures: options.textured
      ? {
          concrete: {
            ktx2: resource("concrete.ktx2", ktx2),
            webp: resource("concrete.webp", webp),
          },
        }
      : {},
  };
  const runtimeBytes = bytes(JSON.stringify(runtime));
  const runtimeDescriptor = resource("runtime.json", runtimeBytes);
  const responses = new Map<string, Response>([
    [baseUrl + "runtime.json", new Response(runtimeBytes)],
    [baseUrl + "scene.json", new Response(sceneBytes)],
    [baseUrl + "vertices.bin", new Response(vertices)],
    [baseUrl + "indices.bin", new Response(indices)],
    [baseUrl + "material.bin", new Response(material)],
    [baseUrl + "concrete.ktx2", new Response(ktx2)],
    [baseUrl + "concrete.webp", new Response(webp)],
  ]);
  const fetch = vi.fn(
    async (input: string) => responses.get(input)?.clone() ?? new Response(null, { status: 404 }),
  );
  return {
    responses,
    options: {
      baseUrl,
      manifest: runtimeDescriptor,
      backend: "webgpu",
      ktx2: true,
      fetch,
    },
  };
}

describe("ResearchCourtyard runtime loader", () => {
  it("loads a reviewed CPU payload with validated scene, binaries, and material", async () => {
    const source = await fixture();
    const result = await new ResearchCourtyardRuntimeLoader().load(source.options);
    expect(result.reason).toBeUndefined();

    expect(result.readiness).toBe("cpu-payload-ktx2");
    expect(result.payload?.vertices.byteLength).toBe(128);
    expect(result.payload?.indices.byteLength).toBe(24);
    expect(result.payload?.material.byteLength).toBe(8);
  });

  it("keeps the published placeholder out of reviewed renderer readiness", async () => {
    const source = await fixture({ placeholder: true });
    const result = await new ResearchCourtyardRuntimeLoader().load(source.options);
    expect(result.readiness).toBe("preview-placeholder");
    expect(result.payload).toBeUndefined();
  });

  it("fails closed on a hash mismatch or missing reviewed binary", async () => {
    const hashMismatch = await fixture();
    hashMismatch.options.manifest.sha256 = "0".repeat(64);
    await expect(
      new ResearchCourtyardRuntimeLoader().load(hashMismatch.options),
    ).resolves.toMatchObject({
      readiness: "failed",
    });

    const missingBinary = await fixture();
    const runtimeResponse = missingBinary.responses.get("/graphics-portfolio/runtime.json")!;
    const runtime = JSON.parse(await runtimeResponse.text()) as Record<string, unknown>;
    runtime.vertices = null;
    const replaced = bytes(JSON.stringify(runtime));
    missingBinary.responses.set("/graphics-portfolio/runtime.json", new Response(replaced));
    missingBinary.options.manifest = resource("runtime.json", replaced);
    await expect(
      new ResearchCourtyardRuntimeLoader().load(missingBinary.options),
    ).resolves.toMatchObject({
      readiness: "failed",
    });
  });

  it("falls back from failed KTX2 to validated WebP", async () => {
    const source = await fixture({ textured: true });
    source.responses.set("/graphics-portfolio/concrete.ktx2", new Response(null, { status: 503 }));
    const result = await new ResearchCourtyardRuntimeLoader().load(source.options);

    expect(result.readiness).toBe("cpu-payload-webp");
    expect(result.payload?.textures[0].selection).toEqual({ kind: "webp", uri: "concrete.webp" });
  });

  it("honors abort and supports repeated payload disposal", async () => {
    const source = await fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(
      new ResearchCourtyardRuntimeLoader().load({ ...source.options, signal: controller.signal }),
    ).rejects.toThrow();

    const loader = new ResearchCourtyardRuntimeLoader();
    const first = await loader.load(source.options);
    const payload = first.payload!;
    payload.dispose();
    payload.dispose();
    attachCourtyardPayload({ add: (cleanup) => cleanup() }, payload);
    loader.dispose();
    loader.dispose();
  });

  it("disposes a fully loaded payload when a newer generation supersedes it", async () => {
    const source = await fixture();
    const loader = new ResearchCourtyardRuntimeLoader();
    let releaseFirst!: () => void;
    let markEntered!: () => void;
    const firstGate = new Promise<void>((resolve) => (releaseFirst = resolve));
    const firstEntered = new Promise<void>((resolve) => (markEntered = resolve));
    let blocked = false;
    const delayedFetch = vi.fn(async (input: string, init?: RequestInit) => {
      if (!blocked && input.endsWith("runtime.json")) {
        blocked = true;
        markEntered();
        await firstGate;
      }
      return source.options.fetch(input, init);
    });

    const firstLoad = loader.load({ ...source.options, fetch: delayedFetch });
    await firstEntered;
    const second = await loader.load(source.options);
    releaseFirst();
    const first = await firstLoad;

    expect(second.readiness).toBe("cpu-payload-ktx2");
    expect(first).toMatchObject({
      readiness: "failed",
      reason: "superseded by a newer load request",
    });
    loader.dispose();
  });
});
