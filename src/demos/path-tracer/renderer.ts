import type { DemoContext } from "../core/types";
import { buildMedianBvh, encodeBvhNodes, encodeTriangles } from "./bvh";
import { createCornellScene, encodeMaterials } from "./scene";
import { PATH_COMPUTE_WGSL, PATH_DISPLAY_WGSL } from "./shaders";

export interface PathTracerEvidence {
  samples: number;
  triangles: number;
  bvhNodes: number;
  estimatedMonteCarloError: number;
}

export function estimatedMonteCarloError(samples: number): number {
  if (!Number.isInteger(samples) || samples < 0) throw new Error("samples must be non-negative");
  return 1 / Math.sqrt(Math.max(1, samples));
}

export class WebGpuPathTracer {
  private constructor(
    private readonly shell: DemoContext,
    private readonly adapter: GPUAdapter,
    private readonly device: GPUDevice,
    private readonly canvasContext: GPUCanvasContext,
    private readonly canvasFormat: GPUTextureFormat,
    private readonly computePipeline: GPUComputePipeline,
    private readonly displayPipeline: GPURenderPipeline,
    private readonly triangleBuffer: GPUBuffer,
    private readonly nodeBuffer: GPUBuffer,
    private readonly materialBuffer: GPUBuffer,
    private readonly uniformBuffer: GPUBuffer,
    private readonly sampler: GPUSampler,
    private readonly triangleCount: number,
    private readonly bvhNodeCount: number,
  ) {}

  private accumulations: [GPUTexture, GPUTexture] | undefined;
  private computeBindGroups: [GPUBindGroup, GPUBindGroup] | undefined;
  private displayBindGroups: [GPUBindGroup, GPUBindGroup] | undefined;
  private readIndex = 0;
  private samples = 0;
  private bounces = 4;
  private width = 1;
  private height = 1;
  private running = false;
  private userPaused = false;
  private disposed = false;
  private raf = 0;
  private cameraRevision = 0;
  private evidenceSink: ((evidence: PathTracerEvidence) => void) | undefined;

  static async create(
    shell: DemoContext,
    bounces: number,
    width: number,
    height: number,
    onDeviceLost: (message: string) => void,
  ): Promise<WebGpuPathTracer> {
    if (!navigator.gpu) throw new Error("WebGPU is unavailable.");
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) throw new Error("No WebGPU adapter was returned.");
    const device = await adapter.requestDevice();
    const allocations: GPUBuffer[] = [];
    let renderer: WebGpuPathTracer | undefined;
    try {
      const canvasContext = shell.canvas.getContext("webgpu");
      if (!canvasContext) throw new Error("The canvas could not create a WebGPU context.");
      const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
      const scene = createCornellScene();
      const bvh = buildMedianBvh(scene.triangles);
      const triangleData = encodeTriangles(bvh.triangles);
      const nodeData = encodeBvhNodes(bvh.nodes);
      const materialData = encodeMaterials(scene.materials);
      const storage = (label: string, data: ArrayBufferView | ArrayBuffer) => {
        const buffer = device.createBuffer({
          label,
          size: Math.ceil(data.byteLength / 4) * 4,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        allocations.push(buffer);
        device.queue.writeBuffer(buffer, 0, data);
        return buffer;
      };
      const [triangleBuffer, nodeBuffer, materialBuffer, uniformBuffer] = await withValidationScope(
        device,
        "Path tracer buffer setup",
        () => {
          const triangles = storage("PathTracer/Triangles", triangleData);
          const nodes = storage("PathTracer/BVH", nodeData);
          const materials = storage("PathTracer/Materials", materialData);
          const uniforms = device.createBuffer({
            label: "PathTracer/Params",
            size: 32,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          });
          allocations.push(uniforms);
          return [triangles, nodes, materials, uniforms] as const;
        },
      );
      const computeModule = device.createShaderModule({
        label: "PathTracer/ComputeWGSL",
        code: PATH_COMPUTE_WGSL,
      });
      const displayModule = device.createShaderModule({
        label: "PathTracer/DisplayWGSL",
        code: PATH_DISPLAY_WGSL,
      });
      await assertShaderModule(computeModule, "Path tracer compute shader");
      await assertShaderModule(displayModule, "Path tracer display shader");
      const computePipeline = await withValidationScope(
        device,
        "Path tracer compute pipeline",
        () =>
          device.createComputePipelineAsync({
            label: "PathTracer/ComputePipeline",
            layout: "auto",
            compute: { module: computeModule, entryPoint: "main" },
          }),
      );
      const displayPipeline = await withValidationScope(
        device,
        "Path tracer display pipeline",
        () =>
          device.createRenderPipelineAsync({
            label: "PathTracer/DisplayPipeline",
            layout: "auto",
            vertex: { module: displayModule, entryPoint: "vs" },
            fragment: {
              module: displayModule,
              entryPoint: "fs",
              targets: [{ format: canvasFormat }],
            },
            primitive: { topology: "triangle-list" },
          }),
      );
      const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });
      renderer = new WebGpuPathTracer(
        shell,
        adapter,
        device,
        canvasContext,
        canvasFormat,
        computePipeline,
        displayPipeline,
        triangleBuffer,
        nodeBuffer,
        materialBuffer,
        uniformBuffer,
        sampler,
        bvh.triangles.length,
        bvh.nodes.length,
      );
      renderer.bounces = bounces;
      await withValidationScope(device, "Path tracer initial targets", () => {
        renderer!.resize(width, height);
      });
      renderer.watchDeviceLoss(onDeviceLost);
      shell.setStatus(
        `CPU median-split BVH built: ${bvh.triangles.length} triangles / ${bvh.nodes.length} nodes.`,
        "success",
      );
      return renderer;
    } catch (error) {
      renderer?.dispose();
      if (!renderer) {
        allocations.forEach((buffer) => buffer.destroy());
        device.destroy();
      }
      throw error;
    }
  }

  get backendLabel(): string {
    return `Raw WebGPU Path Tracer / ${this.adapter.info?.device || this.adapter.info?.architecture || "adapter"}`;
  }

  get sampleCount(): number {
    return this.samples;
  }

  setEvidenceSink(sink: (evidence: PathTracerEvidence) => void): void {
    this.evidenceSink = sink;
    this.reportEvidence();
  }

  resize(width: number, height: number): void {
    if (this.disposed) return;
    const bounds = this.shell.stage.getBoundingClientRect();
    const qualityScale =
      this.shell.quality === "low" ? 0.5 : this.shell.quality === "high" ? 1 : 0.75;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    const targetWidth = Math.max(
      128,
      Math.min(768, Math.floor((width || bounds.width) * dpr * qualityScale)),
    );
    const targetHeight = Math.max(
      128,
      Math.min(768, Math.floor((height || bounds.height) * dpr * qualityScale)),
    );
    if (targetWidth === this.width && targetHeight === this.height && this.accumulations) return;
    this.destroyAccumulations();
    const textures: GPUTexture[] = [];
    try {
      this.shell.canvas.width = targetWidth;
      this.shell.canvas.height = targetHeight;
      this.canvasContext.configure({
        device: this.device,
        format: this.canvasFormat,
        alphaMode: "opaque",
      });
      for (let index = 0; index < 2; index += 1) {
        textures.push(
          this.device.createTexture({
            label: `PathTracer/Accumulation${index}`,
            size: [targetWidth, targetHeight],
            format: "rgba16float",
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
          }),
        );
      }
      const accumulations = textures as [GPUTexture, GPUTexture];
      const computeBindGroups = [0, 1].map((readIndex) =>
        this.device.createBindGroup({
          label: `PathTracer/ComputeBind${readIndex}`,
          layout: this.computePipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: accumulations[readIndex].createView() },
            { binding: 1, resource: accumulations[1 - readIndex].createView() },
            { binding: 2, resource: { buffer: this.triangleBuffer } },
            { binding: 3, resource: { buffer: this.nodeBuffer } },
            { binding: 4, resource: { buffer: this.materialBuffer } },
            { binding: 5, resource: { buffer: this.uniformBuffer } },
          ],
        }),
      ) as [GPUBindGroup, GPUBindGroup];
      const displayBindGroups = [0, 1].map((index) =>
        this.device.createBindGroup({
          label: `PathTracer/DisplayBind${index}`,
          layout: this.displayPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: accumulations[index].createView() },
            { binding: 1, resource: this.sampler },
          ],
        }),
      ) as [GPUBindGroup, GPUBindGroup];
      this.width = targetWidth;
      this.height = targetHeight;
      this.accumulations = accumulations;
      this.computeBindGroups = computeBindGroups;
      this.displayBindGroups = displayBindGroups;
    } catch (error) {
      textures.forEach((texture) => texture.destroy());
      throw error;
    }
    this.reset();
  }

  setBounces(bounces: number): void {
    const next = Math.max(1, Math.min(4, Math.floor(bounces)));
    if (next === this.bounces) return;
    this.bounces = next;
    this.reset();
  }

  setUserPaused(paused: boolean): void {
    if (this.userPaused === paused || this.disposed) return;
    this.userPaused = paused;
    if (paused) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.shell.setMetrics({
        backend: this.backendLabel,
        status: `Paused at ${this.samples} SPP; no GPU work is submitted.`,
        samples: this.samples,
        metricSource: "animation-frame",
      });
      return;
    }
    this.schedule();
  }

  reset(): void {
    this.samples = 0;
    this.readIndex = 0;
    this.cameraRevision += 1;
    this.reportEvidence();
  }

  pause(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  resume(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.schedule();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pause();
    this.destroyAccumulations();
    this.triangleBuffer.destroy();
    this.nodeBuffer.destroy();
    this.materialBuffer.destroy();
    this.uniformBuffer.destroy();
    this.device.destroy();
  }

  private render = (): void => {
    if (!this.running || this.disposed) return;
    this.raf = 0;
    if (this.userPaused) return;
    if (!this.accumulations || !this.computeBindGroups || !this.displayBindGroups) return;
    const writeIndex = 1 - this.readIndex;
    this.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      new Float32Array([
        this.width,
        this.height,
        this.samples,
        this.bounces,
        this.cameraRevision,
        0,
        0,
        0,
      ]),
    );
    const encoder = this.device.createCommandEncoder({
      label: `PathTracer/Sample${this.samples}`,
    });
    const compute = encoder.beginComputePass({ label: "PathTracer/IntegratePass" });
    compute.setPipeline(this.computePipeline);
    compute.setBindGroup(0, this.computeBindGroups[this.readIndex]);
    compute.dispatchWorkgroups(Math.ceil(this.width / 8), Math.ceil(this.height / 8));
    compute.end();
    this.encodeDisplay(encoder, writeIndex);
    this.device.queue.submit([encoder.finish()]);
    this.readIndex = writeIndex;
    this.samples += 1;
    this.shell.setMetrics({
      backend: this.backendLabel,
      status: `${this.samples} SPP · ${this.bounces} bounces · linear rgba16float`,
      samples: this.samples,
      metricSource: "animation-frame",
    });
    this.reportEvidence();
    this.schedule();
  };

  private reportEvidence(): void {
    this.evidenceSink?.({
      samples: this.samples,
      triangles: this.triangleCount,
      bvhNodes: this.bvhNodeCount,
      estimatedMonteCarloError: estimatedMonteCarloError(this.samples),
    });
  }

  private watchDeviceLoss(onDeviceLost: (message: string) => void): void {
    void this.device.lost.then((info) => {
      if (this.disposed) return;
      onDeviceLost(`WebGPU device lost (${info.reason}): ${info.message || "recovery required"}`);
    });
  }

  private schedule(): void {
    if (!this.running || this.userPaused || this.disposed || this.raf) return;
    this.raf = requestAnimationFrame(this.render);
  }

  private encodeDisplay(encoder: GPUCommandEncoder, accumulationIndex: number): void {
    const pass = encoder.beginRenderPass({
      label: "PathTracer/ToneMapPass",
      colorAttachments: [
        {
          view: this.canvasContext.getCurrentTexture().createView(),
          clearValue: { r: 0.005, g: 0.008, b: 0.01, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(this.displayPipeline);
    pass.setBindGroup(0, this.displayBindGroups![accumulationIndex]);
    pass.draw(3);
    pass.end();
  }

  private destroyAccumulations(): void {
    this.accumulations?.forEach((texture) => texture.destroy());
    this.accumulations = undefined;
    this.computeBindGroups = undefined;
    this.displayBindGroups = undefined;
  }
}

async function assertShaderModule(module: GPUShaderModule, label: string): Promise<void> {
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((message) => message.type === "error");
  if (!errors.length) return;
  throw new Error(`${label} failed: ${errors.map((message) => message.message).join("; ")}`);
}

async function withValidationScope<T>(
  device: GPUDevice,
  label: string,
  create: () => T | Promise<T>,
): Promise<T> {
  device.pushErrorScope("validation");
  let result: T | undefined;
  let creationError: unknown;
  try {
    result = await create();
  } catch (error) {
    creationError = error;
  }
  const validationError = await device.popErrorScope();
  if (creationError) throw creationError;
  if (validationError) throw new Error(`${label} failed: ${validationError.message}`);
  return result as T;
}
