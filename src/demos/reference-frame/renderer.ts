import type { DemoContext } from "../core/types";
import { taaJitter, shouldResetHistory, type HistoryState } from "./math";
import {
  DISPLAY_WGSL,
  GBUFFER_WGSL,
  LIGHTING_WGSL,
  RESOLVE_WGSL,
  SHADOW_MAP_WGSL,
  SSAO_WGSL,
} from "./shaders";
import {
  attachmentInfo,
  type AttachmentInfo,
  type AaTechnique,
  type ReferenceView,
  type ShadowTechnique,
} from "./types";

interface ReferenceTextures {
  albedoMetalness: GPUTexture;
  normalRoughness: GPUTexture;
  velocity: GPUTexture;
  linearDepth: GPUTexture;
  deviceDepth: GPUTexture;
  shadowDepth: GPUTexture;
  lighting: GPUTexture;
  ssao: GPUTexture;
  history: [GPUTexture, GPUTexture];
  historyDepth: [GPUTexture, GPUTexture];
}

interface ReferencePipelines {
  shadow: GPURenderPipeline;
  gbuffer: GPURenderPipeline;
  lighting: GPURenderPipeline;
  ssao: GPURenderPipeline;
  resolve: GPURenderPipeline;
  display: GPURenderPipeline;
}

export interface ReferenceFrameOptions {
  view?: ReferenceView;
  shadow?: ShadowTechnique;
  aa?: AaTechnique;
  onDeviceLost?: (message: string) => void;
}

const SHADOW_SIZE = 512;
const UNIFORM_BYTES = 64;

const viewIndex: Record<ReferenceView, number> = {
  final: 0,
  albedo: 1,
  normal: 2,
  depth: 3,
  velocity: 4,
  lighting: 5,
  ssao: 6,
  history: 7,
};

const shadowIndex: Record<ShadowTechnique, number> = { hard: 0, pcf: 1, pcss: 2 };
const aaIndex: Record<AaTechnique, number> = { none: 0, fxaa: 1, taa: 2 };

async function assertValidShaderModule(module: GPUShaderModule, label: string): Promise<void> {
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((message) => message.type === "error");
  if (errors.length === 0) return;
  const detail = errors
    .map((message) => `${message.lineNum}:${message.linePos} ${message.message}`)
    .join("; ");
  throw new Error(`${label} WGSL compilation failed: ${detail}`);
}

async function createValidatedRenderPipeline(
  device: GPUDevice,
  descriptor: GPURenderPipelineDescriptor,
): Promise<GPURenderPipeline> {
  device.pushErrorScope("validation");
  let scopeOpen = true;
  try {
    const pipeline = await device.createRenderPipelineAsync(descriptor);
    const validationError = await device.popErrorScope();
    scopeOpen = false;
    if (validationError) {
      throw new Error(
        `${descriptor.label ?? "Reference frame pipeline"}: ${validationError.message}`,
      );
    }
    return pipeline;
  } catch (error) {
    const validationError = scopeOpen ? await device.popErrorScope() : undefined;
    const message = error instanceof Error ? error.message : String(error);
    const scopeMessage = validationError ? ` ${validationError.message}` : "";
    throw new Error(
      `${descriptor.label ?? "Reference frame pipeline"} could not initialize: ${message}${scopeMessage}`,
      { cause: error },
    );
  }
}

export class ReferenceFrameRenderer {
  private constructor(
    private readonly shell: DemoContext,
    private readonly adapter: GPUAdapter,
    private readonly device: GPUDevice,
    private readonly canvasContext: GPUCanvasContext,
    private readonly canvasFormat: GPUTextureFormat,
    private readonly pipelines: ReferencePipelines,
    private readonly uniformBuffer: GPUBuffer,
    private readonly linearSampler: GPUSampler,
    private readonly options: Required<Omit<ReferenceFrameOptions, "onDeviceLost">> &
      Pick<ReferenceFrameOptions, "onDeviceLost">,
  ) {}

  private textures: ReferenceTextures | undefined;
  private width = 1;
  private height = 1;
  private frameIndex = 0;
  private historyReadIndex = 0;
  private historyValid = false;
  private previousTime = 0;
  private previousJitter: [number, number] = [0, 0];
  private historyState: HistoryState | undefined;
  private sceneRevision = 0;
  private running = false;
  private frozen = false;
  private disposed = false;
  private raf = 0;
  private startedAt = performance.now();

  static async create(
    shell: DemoContext,
    options: ReferenceFrameOptions = {},
  ): Promise<ReferenceFrameRenderer> {
    if (!navigator.gpu) throw new Error("WebGPU is unavailable.");
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) throw new Error("No WebGPU adapter was returned.");
    let device: GPUDevice | undefined;
    let uniformBuffer: GPUBuffer | undefined;
    try {
      const createdDevice = await adapter.requestDevice();
      device = createdDevice;
      const canvasContext = shell.canvas.getContext("webgpu");
      if (!canvasContext) throw new Error("The canvas could not create a WebGPU context.");
      const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
      uniformBuffer = createdDevice.createBuffer({
        label: "ReferenceFrame/Params",
        size: UNIFORM_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const linearSampler = createdDevice.createSampler({
        label: "ReferenceFrame/LinearSampler",
        magFilter: "linear",
        minFilter: "linear",
      });

      const module = (label: string, code: string) =>
        createdDevice.createShaderModule({ label, code });
      const shadowModule = module("ReferenceFrame/ShadowMap", SHADOW_MAP_WGSL);
      const gbufferModule = module("ReferenceFrame/GBuffer", GBUFFER_WGSL);
      const lightingModule = module("ReferenceFrame/Lighting", LIGHTING_WGSL);
      const ssaoModule = module("ReferenceFrame/SSAO", SSAO_WGSL);
      const resolveModule = module("ReferenceFrame/Resolve", RESOLVE_WGSL);
      const displayModule = module("ReferenceFrame/Display", DISPLAY_WGSL);
      await Promise.all([
        assertValidShaderModule(shadowModule, "ReferenceFrame/ShadowMap"),
        assertValidShaderModule(gbufferModule, "ReferenceFrame/GBuffer"),
        assertValidShaderModule(lightingModule, "ReferenceFrame/Lighting"),
        assertValidShaderModule(ssaoModule, "ReferenceFrame/SSAO"),
        assertValidShaderModule(resolveModule, "ReferenceFrame/Resolve"),
        assertValidShaderModule(displayModule, "ReferenceFrame/Display"),
      ]);

      const fullscreenPrimitive: GPUPrimitiveState = { topology: "triangle-list" };
      const pipelines: ReferencePipelines = {
        shadow: await createValidatedRenderPipeline(createdDevice, {
          label: "ReferenceFrame/ShadowPipeline",
          layout: "auto",
          vertex: { module: shadowModule, entryPoint: "vs" },
          fragment: { module: shadowModule, entryPoint: "fs", targets: [{ format: "r32float" }] },
          primitive: fullscreenPrimitive,
        }),
        gbuffer: await createValidatedRenderPipeline(createdDevice, {
          label: "ReferenceFrame/GBufferPipeline",
          layout: "auto",
          vertex: { module: gbufferModule, entryPoint: "vs" },
          fragment: {
            module: gbufferModule,
            entryPoint: "fs",
            targets: [
              { format: "rgba8unorm" },
              { format: "rgba16float" },
              { format: "rg16float" },
              { format: "r32float" },
            ],
          },
          primitive: fullscreenPrimitive,
          depthStencil: {
            format: "depth32float",
            depthWriteEnabled: true,
            depthCompare: "less",
          },
        }),
        lighting: await createValidatedRenderPipeline(createdDevice, {
          label: "ReferenceFrame/LightingPipeline",
          layout: "auto",
          vertex: { module: lightingModule, entryPoint: "vs" },
          fragment: {
            module: lightingModule,
            entryPoint: "fs",
            targets: [{ format: "rgba16float" }],
          },
          primitive: fullscreenPrimitive,
        }),
        ssao: await createValidatedRenderPipeline(createdDevice, {
          label: "ReferenceFrame/SSAOPipeline",
          layout: "auto",
          vertex: { module: ssaoModule, entryPoint: "vs" },
          fragment: { module: ssaoModule, entryPoint: "fs", targets: [{ format: "r8unorm" }] },
          primitive: fullscreenPrimitive,
        }),
        resolve: await createValidatedRenderPipeline(createdDevice, {
          label: "ReferenceFrame/ResolvePipeline",
          layout: "auto",
          vertex: { module: resolveModule, entryPoint: "vs" },
          fragment: {
            module: resolveModule,
            entryPoint: "fs",
            targets: [{ format: "rgba16float" }, { format: "r32float" }],
          },
          primitive: fullscreenPrimitive,
        }),
        display: await createValidatedRenderPipeline(createdDevice, {
          label: "ReferenceFrame/DisplayPipeline",
          layout: "auto",
          vertex: { module: displayModule, entryPoint: "vs" },
          fragment: {
            module: displayModule,
            entryPoint: "fs",
            targets: [{ format: canvasFormat }],
          },
          primitive: fullscreenPrimitive,
        }),
      };

      const renderer = new ReferenceFrameRenderer(
        shell,
        adapter,
        createdDevice,
        canvasContext,
        canvasFormat,
        pipelines,
        uniformBuffer,
        linearSampler,
        {
          view: options.view ?? "final",
          shadow: options.shadow ?? "pcf",
          aa: options.aa ?? "taa",
          onDeviceLost: options.onDeviceLost,
        },
      );
      void createdDevice.lost.then((info) => {
        if (renderer.disposed) return;
        renderer.pause();
        const message = `WebGPU device lost (${info.reason}): ${info.message || "reinitialization required"}`;
        shell.setStatus(message, "warning");
        options.onDeviceLost?.(message);
      });
      return renderer;
    } catch (error) {
      uniformBuffer?.destroy();
      device?.destroy();
      throw error;
    }
  }

  get backendLabel(): string {
    return `Raw WebGPU / ${this.adapter.info?.device || this.adapter.info?.architecture || "adapter"}`;
  }

  get view(): ReferenceView {
    return this.options.view;
  }

  get shadow(): ShadowTechnique {
    return this.options.shadow;
  }

  get aa(): AaTechnique {
    return this.options.aa;
  }

  get frame(): number {
    return this.frameIndex;
  }

  get isFrozen(): boolean {
    return this.frozen;
  }

  get isFallback(): false {
    return false;
  }

  get historyStatus(): string {
    return this.historyValid
      ? `valid / Temporal Resolve frame ${Math.max(0, this.frameIndex - 1)}`
      : "warming / no reusable history";
  }

  getAttachmentInfo(view: ReferenceView): AttachmentInfo {
    const info = attachmentInfo(view);
    return view === "final" ? { ...info, format: this.canvasFormat } : info;
  }

  resize(width: number, height: number): void {
    if (this.disposed) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const nextWidth = Math.max(1, Math.floor(width * dpr));
    const nextHeight = Math.max(1, Math.floor(height * dpr));
    if (nextWidth === this.width && nextHeight === this.height && this.textures) return;
    this.width = nextWidth;
    this.height = nextHeight;
    this.shell.canvas.width = nextWidth;
    this.shell.canvas.height = nextHeight;
    this.canvasContext.configure({
      device: this.device,
      format: this.canvasFormat,
      alphaMode: "opaque",
    });
    this.destroyTextures();
    this.textures = this.createTextures();
    this.resetHistory();
  }

  setView(view: ReferenceView): void {
    this.options.view = view;
    if (this.textures) this.displayOnly();
  }

  setShadow(technique: ShadowTechnique): void {
    if (this.options.shadow === technique) return;
    this.options.shadow = technique;
    this.sceneRevision += 1;
    this.resetHistory();
  }

  setAa(technique: AaTechnique): void {
    if (this.options.aa === technique) return;
    this.options.aa = technique;
    this.resetHistory();
  }

  reset(): void {
    this.sceneRevision += 1;
    this.startedAt = performance.now();
    this.previousTime = 0;
    this.resetHistory();
  }

  setFrozen(frozen: boolean): void {
    this.frozen = frozen;
    if (frozen) {
      cancelAnimationFrame(this.raf);
      this.running = false;
      if (this.textures) this.displayOnly();
    } else {
      this.resume();
    }
  }

  pause(): void {
    if (this.running && !this.frozen) this.resetHistory();
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  resume(): void {
    if (this.running || this.frozen || this.disposed) return;
    this.running = true;
    this.raf = requestAnimationFrame(this.renderLoop);
  }

  renderOnce(now = performance.now()): void {
    if (!this.textures || this.disposed) return;
    const time = (now - this.startedAt) * 0.001;
    const state: HistoryState = {
      width: this.width,
      height: this.height,
      aa: this.options.aa,
      shadow: this.options.shadow,
      sceneRevision: this.sceneRevision,
    };
    if (shouldResetHistory(this.historyState, state)) this.resetHistory();
    this.historyState = state;
    const jitter =
      this.options.aa === "taa"
        ? taaJitter(this.frameIndex, this.width, this.height)
        : ([0, 0] as [number, number]);
    this.writeUniforms(time, jitter);
    const writeIndex = 1 - this.historyReadIndex;
    const encoder = this.device.createCommandEncoder({
      label: `ReferenceFrame/Frame${this.frameIndex}`,
    });
    this.encodeShadow(encoder);
    this.encodeGBuffer(encoder);
    this.encodeLighting(encoder);
    this.encodeSsao(encoder);
    this.encodeResolve(encoder, this.historyReadIndex, writeIndex);
    this.encodeDisplay(encoder, writeIndex);
    this.device.queue.submit([encoder.finish()]);
    this.historyReadIndex = writeIndex;
    this.historyValid = true;
    this.previousTime = time;
    this.previousJitter = jitter;
    this.frameIndex += 1;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pause();
    this.destroyTextures();
    this.uniformBuffer.destroy();
    this.device.destroy();
  }

  private renderLoop = (now: number): void => {
    if (!this.running || this.disposed) return;
    this.renderOnce(now);
    const info = attachmentInfo(this.options.view);
    this.shell.setMetrics({
      backend: this.backendLabel,
      status: `${info.label} / frame ${this.frameIndex} / history ${this.historyStatus}`,
    });
    this.raf = requestAnimationFrame(this.renderLoop);
  };

  private createTextures(): ReferenceTextures {
    const sampledAttachment = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
    const created: GPUTexture[] = [];
    const create = (
      label: string,
      format: GPUTextureFormat,
      width = this.width,
      height = this.height,
      usage = sampledAttachment,
    ) => {
      const texture = this.device.createTexture({ label, size: [width, height], format, usage });
      created.push(texture);
      return texture;
    };
    try {
      return {
        albedoMetalness: create("ReferenceFrame/AlbedoMetalness", "rgba8unorm"),
        normalRoughness: create("ReferenceFrame/NormalRoughness", "rgba16float"),
        velocity: create("ReferenceFrame/Velocity", "rg16float"),
        linearDepth: create("ReferenceFrame/LinearDepth", "r32float"),
        deviceDepth: create(
          "ReferenceFrame/DeviceDepth",
          "depth32float",
          this.width,
          this.height,
          GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        ),
        shadowDepth: create("ReferenceFrame/ShadowDepth", "r32float", SHADOW_SIZE, SHADOW_SIZE),
        lighting: create("ReferenceFrame/Lighting", "rgba16float"),
        ssao: create("ReferenceFrame/SSAO", "r8unorm"),
        history: [
          create("ReferenceFrame/HistoryA", "rgba16float"),
          create("ReferenceFrame/HistoryB", "rgba16float"),
        ],
        historyDepth: [
          create("ReferenceFrame/HistoryDepthA", "r32float"),
          create("ReferenceFrame/HistoryDepthB", "r32float"),
        ],
      };
    } catch (error) {
      created.forEach((texture) => texture.destroy());
      throw error;
    }
  }

  private destroyTextures(): void {
    if (!this.textures) return;
    Object.values(this.textures)
      .flat()
      .forEach((texture) => texture.destroy());
    this.textures = undefined;
  }

  private resetHistory(): void {
    this.historyValid = false;
    this.historyReadIndex = 0;
    this.frameIndex = 0;
    this.previousJitter = [0, 0];
    this.historyState = undefined;
  }

  private writeUniforms(time: number, jitter: [number, number]): void {
    const values = new Float32Array([
      this.width,
      this.height,
      time,
      this.previousTime,
      jitter[0],
      jitter[1],
      this.previousJitter[0],
      this.previousJitter[1],
      shadowIndex[this.options.shadow],
      aaIndex[this.options.aa],
      this.frameIndex,
      this.historyValid ? 1 : 0,
      viewIndex[this.options.view],
      0,
      0,
      0,
    ]);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, values);
  }

  private encodeShadow(encoder: GPUCommandEncoder): void {
    const textures = this.textures!;
    const pass = encoder.beginRenderPass({
      label: "ReferenceFrame/ShadowMapPass",
      colorAttachments: [
        {
          view: textures.shadowDepth.createView(),
          clearValue: { r: 1, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(this.pipelines.shadow);
    pass.setBindGroup(
      0,
      this.device.createBindGroup({
        layout: this.pipelines.shadow.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
      }),
    );
    pass.draw(3);
    pass.end();
  }

  private encodeGBuffer(encoder: GPUCommandEncoder): void {
    const textures = this.textures!;
    const pass = encoder.beginRenderPass({
      label: "ReferenceFrame/GBufferPass",
      colorAttachments: [
        this.colorAttachment(textures.albedoMetalness, [0, 0, 0, 0]),
        this.colorAttachment(textures.normalRoughness, [0.5, 0.5, 1, 1]),
        this.colorAttachment(textures.velocity, [0, 0, 0, 0]),
        this.colorAttachment(textures.linearDepth, [1, 0, 0, 0]),
      ],
      depthStencilAttachment: {
        view: textures.deviceDepth.createView(),
        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });
    pass.setPipeline(this.pipelines.gbuffer);
    pass.setBindGroup(
      0,
      this.device.createBindGroup({
        layout: this.pipelines.gbuffer.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
      }),
    );
    pass.draw(3);
    pass.end();
  }

  private encodeLighting(encoder: GPUCommandEncoder): void {
    const textures = this.textures!;
    const pass = encoder.beginRenderPass({
      label: "ReferenceFrame/LightingPass",
      colorAttachments: [this.colorAttachment(textures.lighting, [0.01, 0.02, 0.025, 1])],
    });
    pass.setPipeline(this.pipelines.lighting);
    pass.setBindGroup(
      0,
      this.device.createBindGroup({
        layout: this.pipelines.lighting.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: textures.albedoMetalness.createView() },
          { binding: 1, resource: textures.normalRoughness.createView() },
          { binding: 2, resource: textures.linearDepth.createView() },
          { binding: 3, resource: textures.shadowDepth.createView() },
          { binding: 4, resource: { buffer: this.uniformBuffer } },
        ],
      }),
    );
    pass.draw(3);
    pass.end();
  }

  private encodeSsao(encoder: GPUCommandEncoder): void {
    const textures = this.textures!;
    const pass = encoder.beginRenderPass({
      label: "ReferenceFrame/SSAOPass",
      colorAttachments: [this.colorAttachment(textures.ssao, [1, 0, 0, 1])],
    });
    pass.setPipeline(this.pipelines.ssao);
    pass.setBindGroup(
      0,
      this.device.createBindGroup({
        layout: this.pipelines.ssao.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: textures.linearDepth.createView() },
          { binding: 1, resource: textures.normalRoughness.createView() },
        ],
      }),
    );
    pass.draw(3);
    pass.end();
  }

  private encodeResolve(encoder: GPUCommandEncoder, readIndex: number, writeIndex: number): void {
    const textures = this.textures!;
    const pass = encoder.beginRenderPass({
      label: "ReferenceFrame/ResolvePass",
      colorAttachments: [
        this.colorAttachment(textures.history[writeIndex], [0, 0, 0, 1]),
        this.colorAttachment(textures.historyDepth[writeIndex], [1, 0, 0, 0]),
      ],
    });
    pass.setPipeline(this.pipelines.resolve);
    pass.setBindGroup(
      0,
      this.device.createBindGroup({
        layout: this.pipelines.resolve.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: textures.lighting.createView() },
          { binding: 1, resource: textures.velocity.createView() },
          { binding: 2, resource: textures.linearDepth.createView() },
          { binding: 3, resource: textures.history[readIndex].createView() },
          { binding: 4, resource: textures.historyDepth[readIndex].createView() },
          { binding: 5, resource: this.linearSampler },
          { binding: 6, resource: { buffer: this.uniformBuffer } },
        ],
      }),
    );
    pass.draw(3);
    pass.end();
  }

  private encodeDisplay(encoder: GPUCommandEncoder, resolvedIndex: number): void {
    const pass = encoder.beginRenderPass({
      label: "ReferenceFrame/DisplayPass",
      colorAttachments: [
        {
          view: this.canvasContext.getCurrentTexture().createView(),
          clearValue: { r: 0.01, g: 0.02, b: 0.025, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(this.pipelines.display);
    pass.setBindGroup(0, this.displayBindGroup(resolvedIndex));
    pass.draw(3);
    pass.end();
  }

  private displayOnly(): void {
    if (!this.textures || this.disposed) return;
    this.writeUniforms(this.previousTime, this.previousJitter);
    const encoder = this.device.createCommandEncoder({ label: "ReferenceFrame/DisplayOnly" });
    this.encodeDisplay(encoder, this.historyReadIndex);
    this.device.queue.submit([encoder.finish()]);
  }

  private displayBindGroup(resolvedIndex: number): GPUBindGroup {
    const textures = this.textures!;
    return this.device.createBindGroup({
      layout: this.pipelines.display.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: textures.albedoMetalness.createView() },
        { binding: 1, resource: textures.normalRoughness.createView() },
        { binding: 2, resource: textures.linearDepth.createView() },
        { binding: 3, resource: textures.velocity.createView() },
        { binding: 4, resource: textures.lighting.createView() },
        { binding: 5, resource: textures.ssao.createView() },
        { binding: 6, resource: textures.history[resolvedIndex].createView() },
        { binding: 7, resource: this.linearSampler },
        { binding: 8, resource: { buffer: this.uniformBuffer } },
      ],
    });
  }

  private colorAttachment(
    texture: GPUTexture,
    clear: readonly [number, number, number, number],
  ): GPURenderPassColorAttachment {
    return {
      view: texture.createView(),
      clearValue: { r: clear[0], g: clear[1], b: clear[2], a: clear[3] },
      loadOp: "clear",
      storeOp: "store",
    };
  }
}
