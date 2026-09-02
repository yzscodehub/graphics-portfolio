import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildResearchCourtyardDrawLists,
  createResearchCourtyardGpuScene,
  updateResearchCourtyardInstanceBytes,
} from "../src/demos/research-courtyard/gpu-scene-v2";
import type { LoadedRuntimeTexture } from "../src/demos/research-courtyard/ktx-runtime-v2";
import type { ResearchCourtyardV2CpuPayload } from "../src/demos/research-courtyard/loader-v2";
import type { PackedSceneV2 } from "../src/demos/research-courtyard/packed-scene-v2";

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] as const;

function lod(
  meshIndex: number,
  level: number,
  instanceOffset: number,
  state: "draw" | "culled" = "draw",
) {
  return {
    state,
    baseVertex: state === "draw" ? (meshIndex * 3 + level) * 3 : 0,
    firstIndex: state === "draw" ? (meshIndex * 3 + level) * 3 : 0,
    indexCount: state === "draw" ? 3 : 0,
    vertexCount: state === "draw" ? 3 : 0,
    relativeError: level * 0.01,
    indirectByteOffset: (meshIndex * 3 + level) * 32,
    instanceOffset,
    instanceCount: state === "draw" ? 1 : 0,
  };
}

function pack() {
  return {
    meshes: [
      {
        id: "opaque",
        lodPolicy: "preserved",
        lods: [lod(0, 0, 0), lod(0, 1, 0), lod(0, 2, 0)],
      },
      {
        id: "alpha",
        lodPolicy: "culled-at-lod2",
        lods: [lod(1, 0, 1), lod(1, 1, 1), lod(1, 2, 1, "culled")],
      },
    ],
    instances: [
      {
        id: "opaque-0",
        currentTransform: identity,
        previousTransform: identity,
        materialIndex: 0,
        meshIndex: 0,
        flags: 0,
        worldSphere: [0, 0, 0, 1],
        animation: null,
      },
      {
        id: "alpha-0",
        currentTransform: identity,
        previousTransform: identity,
        materialIndex: 1,
        meshIndex: 1,
        flags: 1,
        worldSphere: [0, 0, 0, 1],
        animation: {
          kind: "spin-y",
          radiansPerSecond: 1,
          phaseRadians: 0,
        },
      },
    ],
    renderPasses: {
      deferredOpaque: [0],
      alphaMaskForward: [1],
    },
    transport: {
      textures: [
        {
          id: "stone",
          colorSpace: "srgb",
          ktx2: "textures/stone.ktx2",
          webp: "textures/stone.webp",
        },
      ],
    },
  } as unknown as PackedSceneV2;
}

function payload() {
  return {
    pack: pack(),
    buffers: {
      vertices: new ArrayBuffer(32 * 18),
      indices: new ArrayBuffer(4 * 18),
      materials: new ArrayBuffer(64 * 2),
      instances: new ArrayBuffer(128 * 2),
      indirect: new ArrayBuffer(32 * 6),
    },
    environment: {
      basis: "fixture",
      convolution: "fixture",
      coefficients: [],
    },
    runtimeManifest: {
      textures: { stone: {} },
      transcoders: { ktx: {} },
    },
    dispose() {},
  } as unknown as ResearchCourtyardV2CpuPayload;
}

function fakeDevice() {
  const createdBuffers: Array<{ destroy: ReturnType<typeof vi.fn> }> = [];
  const createdTextures: Array<{
    destroy: ReturnType<typeof vi.fn>;
    createView: ReturnType<typeof vi.fn>;
  }> = [];
  const queue = {
    writeBuffer: vi.fn(),
    writeTexture: vi.fn(),
    copyExternalImageToTexture: vi.fn(),
  };
  const device = {
    features: new Set(["texture-compression-bc"]),
    queue,
    createBuffer: vi.fn(() => {
      const buffer = { destroy: vi.fn() };
      createdBuffers.push(buffer);
      return buffer;
    }),
    createTexture: vi.fn(() => {
      const texture = { destroy: vi.fn(), createView: vi.fn(() => ({})) };
      createdTextures.push(texture);
      return texture;
    }),
  } as unknown as GPUDevice;
  return { device, queue, createdBuffers, createdTextures };
}

beforeEach(() => {
  vi.stubGlobal("GPUBufferUsage", {
    COPY_DST: 1,
    VERTEX: 2,
    INDEX: 4,
    STORAGE: 8,
    INDIRECT: 16,
  });
  vi.stubGlobal("GPUTextureUsage", {
    COPY_DST: 1,
    TEXTURE_BINDING: 2,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Research Courtyard v2 GPU scene", () => {
  it("routes opaque and alpha-mask draws and omits explicit culled LODs", () => {
    const draws = buildResearchCourtyardDrawLists(pack());
    expect(draws.opaqueDraws).toHaveLength(3);
    expect(draws.alphaMaskDraws).toHaveLength(2);
    expect(draws.alphaMaskDraws.map((draw) => draw.lod)).toEqual([0, 1]);
    expect(draws.opaqueDraws[0]).toMatchObject({
      materialIndex: 0,
      instanceOffset: 0,
      indirectByteOffset: 0,
    });
  });

  it("writes current and previous animated transforms while preserving static instances", () => {
    const bytes = new ArrayBuffer(128 * 2);
    updateResearchCourtyardInstanceBytes(pack(), bytes, Math.PI / 2, 0);
    const view = new DataView(bytes);
    expect(view.getFloat32(0, true)).toBe(1);
    expect(view.getFloat32(48, true)).toBe(1);
    expect(view.getFloat32(128, true)).toBeCloseTo(0, 5);
    expect(view.getFloat32(136, true)).toBeCloseTo(1, 5);
    expect(view.getFloat32(176, true)).toBe(1);
    expect(view.getFloat32(184, true)).toBe(0);
  });

  it("uploads KTX mips, encodes indirect draws, updates instances, and disposes once", async () => {
    const gpu = fakeDevice();
    const loadedDispose = vi.fn();
    const loadTexture = vi.fn(async () => {
      const loaded: LoadedRuntimeTexture = {
        id: "stone",
        kind: "ktx2",
        texture: {
          kind: "bc7",
          format: "bc7-rgba-unorm-srgb",
          width: 4,
          height: 4,
          mipLevelCount: 1,
          levels: [
            {
              level: 0,
              width: 4,
              height: 4,
              bytesPerRow: 16,
              rowsPerImage: 1,
              data: new Uint8Array(16),
            },
          ],
        },
        dispose: loadedDispose,
      };
      return loaded;
    });
    const scene = await createResearchCourtyardGpuScene({
      device: gpu.device,
      payload: payload(),
      baseUrl: "https://portfolio.test/",
      fetch: vi.fn(),
      createImageBitmap: vi.fn() as unknown as typeof globalThis.createImageBitmap,
      loadTexture,
    });
    expect(scene.readiness).toBe("gpu-ktx2");
    expect(gpu.createdBuffers).toHaveLength(5);
    expect(gpu.createdTextures).toHaveLength(1);
    expect(gpu.queue.writeTexture).toHaveBeenCalledOnce();
    expect(loadedDispose).toHaveBeenCalledOnce();
    const pass = {
      setVertexBuffer: vi.fn(),
      setIndexBuffer: vi.fn(),
      drawIndexedIndirect: vi.fn(),
    } as unknown as GPURenderPassEncoder;
    const bind = vi.fn();
    scene.encodeOpaque(pass, 0, bind);
    scene.encodeAlphaMask(pass, 2, bind);
    expect(pass.drawIndexedIndirect).toHaveBeenCalledOnce();
    expect(bind).toHaveBeenCalledOnce();
    scene.updateInstances(1, 0.9);
    expect(gpu.queue.writeBuffer).toHaveBeenCalledTimes(6);
    scene.dispose();
    scene.dispose();
    expect(gpu.createdBuffers.every((buffer) => buffer.destroy.mock.calls.length === 1)).toBe(true);
    expect(gpu.createdTextures[0].destroy).toHaveBeenCalledOnce();
  });

  it("marks mixed fallback uploads and cleans partial GPU resources after failure", async () => {
    const fallbackGpu = fakeDevice();
    const close = vi.fn();
    const fallback = await createResearchCourtyardGpuScene({
      device: fallbackGpu.device,
      payload: payload(),
      baseUrl: "https://portfolio.test/",
      fetch: vi.fn(),
      createImageBitmap: vi.fn() as unknown as typeof globalThis.createImageBitmap,
      loadTexture: vi.fn(async () => ({
        id: "stone",
        kind: "webp" as const,
        bitmap: { width: 4, height: 4, close } as unknown as ImageBitmap,
        format: "rgba8unorm-srgb" as GPUTextureFormat,
        dispose: close,
      })),
    });
    expect(fallback.readiness).toBe("gpu-webp");
    expect(fallbackGpu.queue.copyExternalImageToTexture).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    fallback.dispose();

    const failedGpu = fakeDevice();
    await expect(
      createResearchCourtyardGpuScene({
        device: failedGpu.device,
        payload: payload(),
        baseUrl: "https://portfolio.test/",
        fetch: vi.fn(),
        createImageBitmap: vi.fn() as unknown as typeof globalThis.createImageBitmap,
        loadTexture: vi.fn(async () => {
          throw new Error("injected texture failure");
        }),
      }),
    ).rejects.toThrow(/injected texture failure/);
    expect(failedGpu.createdBuffers.every((buffer) => buffer.destroy.mock.calls.length === 1)).toBe(
      true,
    );
  });
});
