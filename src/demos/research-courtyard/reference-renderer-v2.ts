import type {
  ResearchCourtyardGpuDraw,
  ResearchCourtyardGpuScene,
  ResearchCourtyardGpuTexture,
} from "./gpu-scene-v2";
import type { ResearchCourtyardV2CpuPayload } from "./loader-v2";
import { PACKED_SCENE_V2_NO_TEXTURE } from "./packed-scene-v2";
import { RESEARCH_COURTYARD_REFERENCE_WGSL } from "./reference-shaders-v2";

export type ResearchCourtyardDebugMode = "final" | "normal" | "roughness" | "metalness";

export interface ResearchCourtyardReferenceRenderOptions {
  lod: 0 | 1 | 2;
  debugMode: ResearchCourtyardDebugMode;
  exposure: number;
}

const debugModes: Record<ResearchCourtyardDebugMode, number> = {
  final: 0,
  normal: 1,
  roughness: 2,
  metalness: 3,
};

export class ResearchCourtyardReferenceRendererError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "ResearchCourtyardReferenceRendererError";
  }
}

function fail(code: string, message: string): never {
  throw new ResearchCourtyardReferenceRendererError(code, message);
}

function normalize(value: readonly number[]) {
  const length = Math.hypot(...value);
  if (!(length > 0)) fail("camera", "encountered a zero-length direction");
  return value.map((entry) => entry / length);
}

function cross(left: readonly number[], right: readonly number[]) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function dot(left: readonly number[], right: readonly number[]) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function cleanZero(value: number) {
  return Object.is(value, -0) ? 0 : value;
}

export function lookAt(
  eye: readonly [number, number, number],
  target: readonly [number, number, number],
) {
  const z = normalize(eye.map((value, index) => value - target[index]));
  const x = normalize(cross([0, 1, 0], z));
  const y = cross(z, x);
  return [
    x[0],
    y[0],
    z[0],
    0,
    x[1],
    y[1],
    z[1],
    0,
    x[2],
    y[2],
    z[2],
    0,
    cleanZero(-dot(x, eye)),
    cleanZero(-dot(y, eye)),
    cleanZero(-dot(z, eye)),
    1,
  ];
}

export function perspective(verticalFovRadians: number, aspect: number, near: number, far: number) {
  if (
    !(verticalFovRadians > 0 && verticalFovRadians < Math.PI) ||
    !(aspect > 0) ||
    !(near > 0 && far > near)
  )
    fail("camera", "perspective parameters are invalid");
  const focal = 1 / Math.tan(verticalFovRadians / 2);
  return [
    focal / aspect,
    0,
    0,
    0,
    0,
    focal,
    0,
    0,
    0,
    0,
    far / (near - far),
    -1,
    0,
    0,
    (far * near) / (near - far),
    0,
  ];
}

export function multiplyMatrices(left: readonly number[], right: readonly number[]) {
  const output = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1)
    for (let row = 0; row < 4; row += 1)
      for (let index = 0; index < 4; index += 1)
        output[column * 4 + row] += left[index * 4 + row] * right[column * 4 + index];
  return output;
}

async function assertShader(module: GPUShaderModule) {
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((message) => message.type === "error");
  if (errors.length)
    fail(
      "shader",
      errors
        .map((message) => `${message.lineNum}:${message.linePos} ${message.message}`)
        .join("\n"),
    );
}

interface DrawBinding {
  uniform: GPUBuffer;
  bindGroup: GPUBindGroup;
  materialIndex: number;
  instanceOffset: number;
  normalEncoding: number;
}

function createSolidTexture(
  device: GPUDevice,
  id: string,
  format: GPUTextureFormat,
  color: readonly [number, number, number, number],
): ResearchCourtyardGpuTexture {
  const texture = device.createTexture({
    label: `Research Courtyard / ${id}`,
    size: [1, 1, 1],
    format,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture(
    { texture },
    new Uint8Array(color),
    { bytesPerRow: 4, rowsPerImage: 1 },
    [1, 1, 1],
  );
  return {
    id,
    sourceKind: "webp",
    texture,
    view: texture.createView(),
    format,
    mipLevelCount: 1,
  };
}

function textureFor(
  payload: ResearchCourtyardV2CpuPayload,
  scene: ResearchCourtyardGpuScene,
  index: number,
  fallback: ResearchCourtyardGpuTexture,
) {
  if (index === PACKED_SCENE_V2_NO_TEXTURE) return fallback;
  const descriptor = payload.pack.transport.textures[index];
  const texture = descriptor && scene.textures.get(descriptor.id);
  if (!texture) fail("texture", `texture index ${index} is unavailable`);
  return texture;
}

export class ResearchCourtyardReferenceRendererV2 {
  private depth: GPUTexture | undefined;
  private width = 1;
  private height = 1;
  private previousTime = 0;
  private disposed = false;

  private constructor(
    private readonly device: GPUDevice,
    private readonly payload: ResearchCourtyardV2CpuPayload,
    private readonly scene: ResearchCourtyardGpuScene,
    private readonly opaquePipeline: GPURenderPipeline,
    private readonly alphaPipeline: GPURenderPipeline,
    private readonly frameUniform: GPUBuffer,
    private readonly drawBindings: ReadonlyMap<number, DrawBinding>,
    private readonly ownedTextures: readonly ResearchCourtyardGpuTexture[],
  ) {}

  static async create(options: {
    device: GPUDevice;
    format: GPUTextureFormat;
    payload: ResearchCourtyardV2CpuPayload;
    scene: ResearchCourtyardGpuScene;
  }) {
    const { device, format, payload, scene } = options;
    const shader = device.createShaderModule({
      label: "Research Courtyard / Reference WGSL",
      code: RESEARCH_COURTYARD_REFERENCE_WGSL,
    });
    await assertShader(shader);
    const bindGroupLayout = device.createBindGroupLayout({
      label: "Research Courtyard / Reference bind group",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
        {
          binding: 4,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" },
        },
        {
          binding: 5,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" },
        },
        {
          binding: 6,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" },
        },
        {
          binding: 7,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: "filtering" },
        },
      ],
    });
    const pipelineLayout = device.createPipelineLayout({
      label: "Research Courtyard / Reference pipeline layout",
      bindGroupLayouts: [bindGroupLayout],
    });
    const vertex: GPUVertexState = {
      module: shader,
      entryPoint: "vertexMain",
      buffers: [
        {
          arrayStride: 32,
          attributes: [
            { shaderLocation: 0, format: "float32x3", offset: 0 },
            { shaderLocation: 1, format: "snorm16x2", offset: 12 },
            { shaderLocation: 2, format: "snorm16x4", offset: 16 },
            { shaderLocation: 3, format: "float16x2", offset: 24 },
          ],
        },
      ],
    };
    const fragment: GPUFragmentState = {
      module: shader,
      entryPoint: "fragmentMain",
      targets: [{ format }],
    };
    const common = {
      layout: pipelineLayout,
      vertex,
      fragment,
      depthStencil: {
        format: "depth24plus" as GPUTextureFormat,
        depthWriteEnabled: true,
        depthCompare: "less" as GPUCompareFunction,
      },
    };
    const [opaquePipeline, alphaPipeline] = await Promise.all([
      device.createRenderPipelineAsync({
        label: "Research Courtyard / Opaque pipeline",
        ...common,
        primitive: { topology: "triangle-list", cullMode: "back" },
      }),
      device.createRenderPipelineAsync({
        label: "Research Courtyard / Alpha mask pipeline",
        ...common,
        primitive: { topology: "triangle-list", cullMode: "none" },
      }),
    ]);
    const frameUniform = device.createBuffer({
      label: "Research Courtyard / Frame uniform",
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const sampler = device.createSampler({
      label: "Research Courtyard / Material sampler",
      addressModeU: "repeat",
      addressModeV: "repeat",
      minFilter: "linear",
      magFilter: "linear",
      mipmapFilter: "linear",
      maxAnisotropy: 8,
    });
    const fallbackBase = createSolidTexture(
      device,
      "fallback base color",
      "rgba8unorm-srgb",
      [255, 255, 255, 255],
    );
    const fallbackNormal = createSolidTexture(
      device,
      "fallback normal",
      "rgba8unorm",
      [128, 128, 255, 255],
    );
    const fallbackOrm = createSolidTexture(
      device,
      "fallback ORM",
      "rgba8unorm",
      [255, 255, 255, 255],
    );
    const ownedTextures = [fallbackBase, fallbackNormal, fallbackOrm];
    const drawBindings = new Map<number, DrawBinding>();
    const draws = [...scene.opaqueDraws, ...scene.alphaMaskDraws];
    for (const draw of draws) {
      if (drawBindings.has(draw.meshIndex)) continue;
      const material = payload.pack.materials[draw.materialIndex];
      if (!material) fail("material", `material ${draw.materialIndex} is unavailable`);
      const base = textureFor(payload, scene, material.textureIndices.baseColor, fallbackBase);
      const normal = textureFor(payload, scene, material.textureIndices.normal, fallbackNormal);
      const orm = textureFor(payload, scene, material.textureIndices.orm, fallbackOrm);
      const uniform = device.createBuffer({
        label: `Research Courtyard / Draw ${draw.meshIndex}`,
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const binding: DrawBinding = {
        uniform,
        materialIndex: draw.materialIndex,
        instanceOffset: draw.instanceOffset,
        normalEncoding: normal.sourceKind === "ktx2" ? 1 : 0,
        bindGroup: device.createBindGroup({
          label: `Research Courtyard / Draw ${draw.meshIndex}`,
          layout: bindGroupLayout,
          entries: [
            { binding: 0, resource: { buffer: frameUniform } },
            { binding: 1, resource: { buffer: scene.buffers.material } },
            { binding: 2, resource: { buffer: scene.buffers.instance } },
            { binding: 3, resource: { buffer: uniform } },
            { binding: 4, resource: base.view },
            { binding: 5, resource: normal.view },
            { binding: 6, resource: orm.view },
            { binding: 7, resource: sampler },
          ],
        }),
      };
      drawBindings.set(draw.meshIndex, binding);
    }
    return new ResearchCourtyardReferenceRendererV2(
      device,
      payload,
      scene,
      opaquePipeline,
      alphaPipeline,
      frameUniform,
      drawBindings,
      ownedTextures,
    );
  }

  resize(width: number, height: number): void {
    if (this.disposed) return;
    const nextWidth = Math.max(1, Math.floor(width));
    const nextHeight = Math.max(1, Math.floor(height));
    if (this.depth && this.width === nextWidth && this.height === nextHeight) return;
    const next = this.device.createTexture({
      label: "Research Courtyard / Reference depth",
      size: [nextWidth, nextHeight, 1],
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.depth?.destroy();
    this.depth = next;
    this.width = nextWidth;
    this.height = nextHeight;
  }

  encode(
    encoder: GPUCommandEncoder,
    target: GPUTextureView,
    time: number,
    options: ResearchCourtyardReferenceRenderOptions,
  ): void {
    if (this.disposed) return;
    if (!this.depth) fail("render", "resize must create a depth target before encoding");
    if (!Number.isFinite(time) || !Number.isFinite(options.exposure) || options.exposure <= 0)
      fail("render", "time and exposure must be finite and exposure positive");
    this.scene.updateInstances(time, this.previousTime);
    this.previousTime = time;
    this.writeFrameUniform(options.exposure);
    const debugMode = debugModes[options.debugMode];
    for (const binding of this.drawBindings.values())
      this.device.queue.writeBuffer(
        binding.uniform,
        0,
        new Uint32Array([
          binding.materialIndex,
          binding.instanceOffset,
          binding.normalEncoding,
          debugMode,
        ]),
      );
    const pass = encoder.beginRenderPass({
      label: "Research Courtyard / Reference frame",
      colorAttachments: [
        {
          view: target,
          clearValue: [0.006, 0.009, 0.009, 1],
          loadOp: "clear",
          storeOp: "store",
        },
      ],
      depthStencilAttachment: {
        view: this.depth.createView(),
        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });
    const bindDraw = (draw: ResearchCourtyardGpuDraw) => {
      const binding = this.drawBindings.get(draw.meshIndex);
      if (!binding) fail("draw", `mesh ${draw.meshIndex} has no bind group`);
      pass.setBindGroup(0, binding.bindGroup);
    };
    pass.setPipeline(this.opaquePipeline);
    this.scene.encodeOpaque(pass, options.lod, bindDraw);
    pass.setPipeline(this.alphaPipeline);
    this.scene.encodeAlphaMask(pass, options.lod, bindDraw);
    pass.end();
  }

  private writeFrameUniform(exposure: number) {
    const eye: [number, number, number] = [10.5, 6.2, -7.5];
    const target: [number, number, number] = [0, 1.6, 6];
    const view = lookAt(eye, target);
    const projection = perspective((45 * Math.PI) / 180, this.width / this.height, 0.1, 100);
    const data = new Float32Array(64);
    data.set(multiplyMatrices(projection, view), 0);
    data.set([...eye, exposure], 16);
    const sun = normalize([-0.45, 0.82, -0.35]);
    data.set([...sun, 3.2], 20);
    data.set([1, 0.95, 0.86, 0], 24);
    this.payload.environment.coefficients.forEach((coefficient, index) => {
      data.set([...coefficient.rgb, 0], 28 + index * 4);
    });
    this.device.queue.writeBuffer(this.frameUniform, 0, data);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.depth?.destroy();
    this.depth = undefined;
    this.frameUniform.destroy();
    for (const binding of this.drawBindings.values()) binding.uniform.destroy();
    for (const texture of this.ownedTextures) texture.texture.destroy();
  }
}
