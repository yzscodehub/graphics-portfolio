import {
  KtxReadModuleLoader,
  loadRuntimeTexture,
  type LoadedRuntimeTexture,
} from "./ktx-runtime-v2";
import type { ResearchCourtyardV2CpuPayload } from "./loader-v2";
import type { PackedSceneV2 } from "./packed-scene-v2";

export interface ResearchCourtyardGpuDraw {
  meshIndex: number;
  lod: 0 | 1 | 2;
  materialIndex: number;
  indirectByteOffset: number;
  instanceOffset: number;
  instanceCount: number;
}

export interface ResearchCourtyardGpuTexture {
  id: string;
  sourceKind: "ktx2" | "webp";
  texture: GPUTexture;
  view: GPUTextureView;
  format: GPUTextureFormat;
  mipLevelCount: number;
}

export interface ResearchCourtyardGpuScene {
  readonly readiness: "gpu-ktx2" | "gpu-webp";
  readonly opaqueDraws: readonly ResearchCourtyardGpuDraw[];
  readonly alphaMaskDraws: readonly ResearchCourtyardGpuDraw[];
  readonly textures: ReadonlyMap<string, ResearchCourtyardGpuTexture>;
  readonly buffers: {
    vertex: GPUBuffer;
    index: GPUBuffer;
    material: GPUBuffer;
    instance: GPUBuffer;
    indirect: GPUBuffer;
  };
  updateInstances(time: number, previousTime: number): void;
  encodeOpaque(
    pass: GPURenderPassEncoder,
    lod: 0 | 1 | 2,
    bindDraw: (draw: ResearchCourtyardGpuDraw) => void,
  ): void;
  encodeAlphaMask(
    pass: GPURenderPassEncoder,
    lod: 0 | 1 | 2,
    bindDraw: (draw: ResearchCourtyardGpuDraw) => void,
  ): void;
  dispose(): void;
}

export interface CreateResearchCourtyardGpuSceneOptions {
  device: GPUDevice;
  payload: ResearchCourtyardV2CpuPayload;
  baseUrl: string;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  moduleLoader?: KtxReadModuleLoader;
  createImageBitmap?: typeof globalThis.createImageBitmap;
  signal?: AbortSignal;
  loadTexture?: typeof loadRuntimeTexture;
}

export class ResearchCourtyardGpuSceneError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "ResearchCourtyardGpuSceneError";
  }
}

function fail(code: string, message: string): never {
  throw new ResearchCourtyardGpuSceneError(code, message);
}

export function buildResearchCourtyardDrawLists(pack: PackedSceneV2) {
  const alphaInstances = new Set(pack.renderPasses.alphaMaskForward);
  const opaqueDraws: ResearchCourtyardGpuDraw[] = [];
  const alphaMaskDraws: ResearchCourtyardGpuDraw[] = [];
  pack.meshes.forEach((mesh, meshIndex) => {
    mesh.lods.forEach((level, lod) => {
      if (level.state === "culled") return;
      const instance = pack.instances[level.instanceOffset];
      if (!instance || instance.meshIndex !== meshIndex)
        fail("draw", `mesh ${meshIndex} has an invalid instance span`);
      const alpha = alphaInstances.has(level.instanceOffset);
      for (
        let instanceIndex = level.instanceOffset;
        instanceIndex < level.instanceOffset + level.instanceCount;
        instanceIndex += 1
      )
        if (alphaInstances.has(instanceIndex) !== alpha)
          fail("draw", `mesh ${meshIndex} crosses render-pass assignments`);
      const draw: ResearchCourtyardGpuDraw = {
        meshIndex,
        lod: lod as 0 | 1 | 2,
        materialIndex: instance.materialIndex,
        indirectByteOffset: level.indirectByteOffset,
        instanceOffset: level.instanceOffset,
        instanceCount: level.instanceCount,
      };
      (alpha ? alphaMaskDraws : opaqueDraws).push(draw);
    });
  });
  return {
    opaqueDraws,
    alphaMaskDraws,
  };
}

function createBuffer(
  device: GPUDevice,
  label: string,
  bytes: ArrayBuffer,
  usage: GPUBufferUsageFlags,
) {
  if (bytes.byteLength === 0 || bytes.byteLength % 4 !== 0)
    fail("buffer", `${label} has an invalid byte length`);
  const buffer = device.createBuffer({
    label,
    size: bytes.byteLength,
    usage: usage | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(buffer, 0, bytes);
  return buffer;
}

function localSpin(base: readonly number[], radians: number) {
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const output = [...base];
  for (const row of [0, 4, 8]) {
    const x = base[row];
    const z = base[row + 2];
    output[row] = x * cosine - z * sine;
    output[row + 2] = x * sine + z * cosine;
  }
  return output;
}

function writeTransform(view: DataView, offset: number, matrix: readonly number[]) {
  for (let index = 0; index < 12; index += 1)
    view.setFloat32(offset + index * 4, matrix[index], true);
}

export function updateResearchCourtyardInstanceBytes(
  pack: PackedSceneV2,
  bytes: ArrayBuffer,
  time: number,
  previousTime: number,
) {
  if (bytes.byteLength !== pack.instances.length * 128)
    fail("instances", "CPU instance bytes do not match Pack v2");
  if (!Number.isFinite(time) || !Number.isFinite(previousTime))
    fail("instances", "animation times must be finite");
  const view = new DataView(bytes);
  pack.instances.forEach((instance, index) => {
    const current = instance.animation
      ? localSpin(
          instance.currentTransform,
          instance.animation.phaseRadians + time * instance.animation.radiansPerSecond,
        )
      : instance.currentTransform;
    const previous = instance.animation
      ? localSpin(
          instance.currentTransform,
          instance.animation.phaseRadians + previousTime * instance.animation.radiansPerSecond,
        )
      : instance.previousTransform;
    writeTransform(view, index * 128, current);
    writeTransform(view, index * 128 + 48, previous);
  });
  return bytes;
}

function uploadTexture(
  device: GPUDevice,
  loaded: LoadedRuntimeTexture,
): ResearchCourtyardGpuTexture {
  if (loaded.kind === "ktx2") {
    const source = loaded.texture;
    const texture = device.createTexture({
      label: `Research Courtyard / ${loaded.id}`,
      size: {
        width: source.width,
        height: source.height,
        depthOrArrayLayers: 1,
      },
      mipLevelCount: source.mipLevelCount,
      format: source.format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    for (const level of source.levels)
      device.queue.writeTexture(
        { texture, mipLevel: level.level },
        level.data,
        {
          bytesPerRow: level.bytesPerRow,
          rowsPerImage: level.rowsPerImage,
        },
        {
          width: level.width,
          height: level.height,
          depthOrArrayLayers: 1,
        },
      );
    return {
      id: loaded.id,
      sourceKind: "ktx2",
      texture,
      view: texture.createView(),
      format: source.format,
      mipLevelCount: source.mipLevelCount,
    };
  }
  const texture = device.createTexture({
    label: `Research Courtyard / ${loaded.id} / WebP fallback`,
    size: {
      width: loaded.bitmap.width,
      height: loaded.bitmap.height,
      depthOrArrayLayers: 1,
    },
    mipLevelCount: 1,
    format: loaded.format,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.copyExternalImageToTexture(
    { source: loaded.bitmap },
    { texture },
    {
      width: loaded.bitmap.width,
      height: loaded.bitmap.height,
      depthOrArrayLayers: 1,
    },
  );
  return {
    id: loaded.id,
    sourceKind: "webp",
    texture,
    view: texture.createView(),
    format: loaded.format,
    mipLevelCount: 1,
  };
}

function encodeDraws(
  pass: GPURenderPassEncoder,
  lod: 0 | 1 | 2,
  draws: readonly ResearchCourtyardGpuDraw[],
  vertexBuffer: GPUBuffer,
  indexBuffer: GPUBuffer,
  indirectBuffer: GPUBuffer,
  bindDraw: (draw: ResearchCourtyardGpuDraw) => void,
) {
  pass.setVertexBuffer(0, vertexBuffer);
  pass.setIndexBuffer(indexBuffer, "uint32");
  for (const draw of draws) {
    if (draw.lod !== lod) continue;
    bindDraw(draw);
    pass.drawIndexedIndirect(indirectBuffer, draw.indirectByteOffset);
  }
}

export async function createResearchCourtyardGpuScene(
  options: CreateResearchCourtyardGpuSceneOptions,
): Promise<ResearchCourtyardGpuScene> {
  const { device, payload } = options;
  const buffers: GPUBuffer[] = [];
  const textures = new Map<string, ResearchCourtyardGpuTexture>();
  const loadTexture = options.loadTexture ?? loadRuntimeTexture;
  const moduleLoader = options.moduleLoader ?? new KtxReadModuleLoader();
  const createImageBitmap = options.createImageBitmap ?? globalThis.createImageBitmap;
  try {
    const vertexBuffer = createBuffer(
      device,
      "Research Courtyard / vertices",
      payload.buffers.vertices,
      GPUBufferUsage.VERTEX,
    );
    const indexBuffer = createBuffer(
      device,
      "Research Courtyard / indices",
      payload.buffers.indices,
      GPUBufferUsage.INDEX,
    );
    const materialBuffer = createBuffer(
      device,
      "Research Courtyard / materials",
      payload.buffers.materials,
      GPUBufferUsage.STORAGE,
    );
    const instanceBytes = payload.buffers.instances.slice(0);
    const instanceBuffer = createBuffer(
      device,
      "Research Courtyard / instances",
      instanceBytes,
      GPUBufferUsage.STORAGE,
    );
    const indirectBuffer = createBuffer(
      device,
      "Research Courtyard / indirect",
      payload.buffers.indirect,
      GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE,
    );
    buffers.push(vertexBuffer, indexBuffer, materialBuffer, instanceBuffer, indirectBuffer);

    let usedWebp = false;
    for (const source of payload.pack.transport.textures) {
      if (!createImageBitmap)
        fail("texture", "createImageBitmap is unavailable for the required fallback");
      const loaded = await loadTexture(source.id, {
        baseUrl: options.baseUrl,
        runtime: payload.runtimeManifest,
        deviceFeatures: new Set(device.features),
        fetch: options.fetch,
        moduleLoader,
        createImageBitmap,
        signal: options.signal,
      });
      try {
        const uploaded = uploadTexture(device, loaded);
        textures.set(uploaded.id, uploaded);
        usedWebp ||= loaded.kind === "webp";
      } finally {
        loaded.dispose();
      }
    }
    const draws = buildResearchCourtyardDrawLists(payload.pack);
    let disposed = false;
    const scene: ResearchCourtyardGpuScene = {
      readiness: usedWebp ? "gpu-webp" : "gpu-ktx2",
      opaqueDraws: draws.opaqueDraws,
      alphaMaskDraws: draws.alphaMaskDraws,
      textures,
      buffers: {
        vertex: vertexBuffer,
        index: indexBuffer,
        material: materialBuffer,
        instance: instanceBuffer,
        indirect: indirectBuffer,
      },
      updateInstances(time, previousTime) {
        if (disposed) return;
        updateResearchCourtyardInstanceBytes(payload.pack, instanceBytes, time, previousTime);
        device.queue.writeBuffer(instanceBuffer, 0, instanceBytes);
      },
      encodeOpaque(pass, lod, bindDraw) {
        if (disposed) return;
        encodeDraws(
          pass,
          lod,
          draws.opaqueDraws,
          vertexBuffer,
          indexBuffer,
          indirectBuffer,
          bindDraw,
        );
      },
      encodeAlphaMask(pass, lod, bindDraw) {
        if (disposed) return;
        encodeDraws(
          pass,
          lod,
          draws.alphaMaskDraws,
          vertexBuffer,
          indexBuffer,
          indirectBuffer,
          bindDraw,
        );
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        for (const texture of textures.values()) texture.texture.destroy();
        textures.clear();
        for (const buffer of buffers) buffer.destroy();
      },
    };
    return scene;
  } catch (error) {
    for (const texture of textures.values()) texture.texture.destroy();
    for (const buffer of buffers) buffer.destroy();
    throw error;
  }
}
