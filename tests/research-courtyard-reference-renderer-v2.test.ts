import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ResearchCourtyardGpuDraw,
  ResearchCourtyardGpuScene,
} from "../src/demos/research-courtyard/gpu-scene-v2";
import type { ResearchCourtyardV2CpuPayload } from "../src/demos/research-courtyard/loader-v2";
import {
  lookAt,
  multiplyMatrices,
  perspective,
  ResearchCourtyardReferenceRendererV2,
} from "../src/demos/research-courtyard/reference-renderer-v2";
import { RESEARCH_COURTYARD_REFERENCE_WGSL } from "../src/demos/research-courtyard/reference-shaders-v2";

function fakeBuffer() {
  return { destroy: vi.fn() } as unknown as GPUBuffer;
}

function fixture() {
  const draw: ResearchCourtyardGpuDraw = {
    meshIndex: 0,
    lod: 0,
    materialIndex: 0,
    indirectByteOffset: 0,
    instanceOffset: 0,
    instanceCount: 1,
  };
  const scene = {
    readiness: "gpu-ktx2",
    opaqueDraws: [draw],
    alphaMaskDraws: [],
    textures: new Map(),
    buffers: {
      vertex: fakeBuffer(),
      index: fakeBuffer(),
      material: fakeBuffer(),
      instance: fakeBuffer(),
      indirect: fakeBuffer(),
    },
    updateInstances: vi.fn(),
    encodeOpaque: vi.fn(
      (
        _pass: GPURenderPassEncoder,
        _lod: number,
        bind: (value: ResearchCourtyardGpuDraw) => void,
      ) => bind(draw),
    ),
    encodeAlphaMask: vi.fn(),
    dispose: vi.fn(),
  } as unknown as ResearchCourtyardGpuScene;
  const payload = {
    pack: {
      materials: [
        {
          textureIndices: {
            baseColor: 0xffffffff,
            normal: 0xffffffff,
            orm: 0xffffffff,
          },
        },
      ],
      transport: { textures: [] },
    },
    environment: {
      basis: "real-sh-y-up-v1",
      convolution: "lambertian-cosine-v1",
      coefficients: Array.from({ length: 9 }, (_, index) => ({
        index,
        l: index === 0 ? 0 : index < 4 ? 1 : 2,
        m: 0,
        rgb: [1, 1, 1],
      })),
    },
  } as unknown as ResearchCourtyardV2CpuPayload;
  return { scene, payload };
}

function fakeDevice() {
  const buffers: Array<{ destroy: ReturnType<typeof vi.fn> }> = [];
  const textures: Array<{
    destroy: ReturnType<typeof vi.fn>;
    createView: ReturnType<typeof vi.fn>;
  }> = [];
  const device = {
    limits: { maxSamplerAnisotropy: 16 },
    queue: {
      writeTexture: vi.fn(),
      writeBuffer: vi.fn(),
    },
    createShaderModule: vi.fn(() => ({
      getCompilationInfo: async () => ({ messages: [] }),
    })),
    createBindGroupLayout: vi.fn(() => ({})),
    createPipelineLayout: vi.fn(() => ({})),
    createRenderPipelineAsync: vi.fn(async () => ({})),
    createBuffer: vi.fn(() => {
      const buffer = { destroy: vi.fn() };
      buffers.push(buffer);
      return buffer;
    }),
    createSampler: vi.fn(() => ({})),
    createTexture: vi.fn(() => {
      const texture = { destroy: vi.fn(), createView: vi.fn(() => ({})) };
      textures.push(texture);
      return texture;
    }),
    createBindGroup: vi.fn(() => ({})),
  } as unknown as GPUDevice;
  return { device, buffers, textures };
}

beforeEach(() => {
  vi.stubGlobal("GPUShaderStage", { VERTEX: 1, FRAGMENT: 2 });
  vi.stubGlobal("GPUBufferUsage", { UNIFORM: 1, COPY_DST: 2 });
  vi.stubGlobal("GPUTextureUsage", {
    TEXTURE_BINDING: 1,
    COPY_DST: 2,
    RENDER_ATTACHMENT: 4,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Research Courtyard Reference Renderer v2", () => {
  it("uses a right-handed WebGPU camera and stable matrix multiplication", () => {
    const view = lookAt([0, 0, 5], [0, 0, 0]);
    expect(view.slice(12, 16)).toEqual([0, 0, -5, 1]);
    const projection = perspective(Math.PI / 2, 1, 0.1, 100);
    expect(projection[0]).toBeCloseTo(1);
    expect(projection[5]).toBeCloseTo(1);
    const combined = multiplyMatrices(projection, view);
    expect(combined).toHaveLength(16);
    expect(combined.every(Number.isFinite)).toBe(true);
  });

  it("contains real vertex/material/instance shading and no fullscreen courtyard proxy", () => {
    expect(RESEARCH_COURTYARD_REFERENCE_WGSL).toContain("draw.instanceOffset + localInstance");
    expect(RESEARCH_COURTYARD_REFERENCE_WGSL).toContain("evaluateDiffuseSh");
    expect(RESEARCH_COURTYARD_REFERENCE_WGSL).toContain("distributionGgx");
    expect(RESEARCH_COURTYARD_REFERENCE_WGSL).not.toContain("courtyardSurface");
  });

  it("creates pipelines and bindings, then encodes and disposes a frame", async () => {
    const gpu = fakeDevice();
    const input = fixture();
    const renderer = await ResearchCourtyardReferenceRendererV2.create({
      device: gpu.device,
      format: "bgra8unorm",
      payload: input.payload,
      scene: input.scene,
    });
    renderer.resize(640, 360);
    const pass = {
      setPipeline: vi.fn(),
      setBindGroup: vi.fn(),
      end: vi.fn(),
    };
    const encoder = {
      beginRenderPass: vi.fn(() => pass),
    } as unknown as GPUCommandEncoder;
    renderer.encode(encoder, {} as GPUTextureView, 1, {
      lod: 0,
      debugMode: "final",
      exposure: 1,
    });
    expect(input.scene.updateInstances).toHaveBeenCalledWith(1, 0);
    expect(input.scene.encodeOpaque).toHaveBeenCalledOnce();
    expect(input.scene.encodeAlphaMask).toHaveBeenCalledOnce();
    expect(pass.setPipeline).toHaveBeenCalledTimes(2);
    expect(pass.setBindGroup).toHaveBeenCalledOnce();
    expect(pass.end).toHaveBeenCalledOnce();
    renderer.dispose();
    renderer.dispose();
    expect(gpu.buffers.every((buffer) => buffer.destroy.mock.calls.length === 1)).toBe(true);
    expect(gpu.textures.every((texture) => texture.destroy.mock.calls.length === 1)).toBe(true);
    expect(input.scene.dispose).not.toHaveBeenCalled();
  });
});
