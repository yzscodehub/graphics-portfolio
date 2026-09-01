import type { DemoContext } from "../core/types";
import {
  CLUSTER_LIGHT_COUNTS,
  DEFAULT_CLUSTER_GRID,
  buildClusteredLightAssignments,
  buildDynamicLights,
  clusterCount,
  compareFixedGpuClusterReadback,
  packDynamicLights,
  type ClusterBuildResult,
  type ClusterView,
  type LightingMode,
  verifyClusteredLightAssignments,
} from "./core";
import { CLUSTER_ASSIGN_WGSL, GBUFFER_WGSL, LIGHTING_WGSL } from "./shaders";
import { buildProceduralResearchCourtyard } from "../research-courtyard/scene";

export interface ClusteredLightingRenderer {
  readonly backendLabel: string;
  readonly scenePrimitiveCount: number;
  resize(width: number, height: number): void;
  setMode(mode: LightingMode): void;
  setLightCount(count: (typeof CLUSTER_LIGHT_COUNTS)[number]): void;
  setView(view: ClusterView): void;
  pause(): void;
  resume(): void;
  dispose(): void;
}

interface Targets {
  albedo: GPUTexture;
  normalDepth: GPUTexture;
}

const MODE_INDEX: Record<LightingMode, number> = { naive: 0, deferred: 1, clustered: 2 };
const VIEW_INDEX: Record<ClusterView, number> = {
  final: 0,
  gbuffer: 1,
  "depth-slice": 2,
  "cluster-heatmap": 3,
};

export class WebGpuClusteredLightingRenderer implements ClusteredLightingRenderer {
  readonly backendLabel = "Raw WebGPU Compute / CPU reference verifier";
  readonly scenePrimitiveCount = buildProceduralResearchCourtyard().boxes.length;

  private readonly gbufferPipeline: GPURenderPipeline;
  private readonly assignmentPipeline: GPUComputePipeline;
  private readonly lightingPipeline: GPURenderPipeline;
  private readonly lightBuffer: GPUBuffer;
  private readonly headerBuffer: GPUBuffer;
  private readonly indexBuffer: GPUBuffer;
  private readonly overflowBuffer: GPUBuffer;
  private readonly uniformBuffer: GPUBuffer;
  private readonly assignmentBindGroup: GPUBindGroup;
  private readonly assignmentReadback: ClusterAssignmentReadback;
  private targets: Targets | undefined;
  private mode: LightingMode = "clustered";
  private view: ClusterView = "final";
  private lightCount: (typeof CLUSTER_LIGHT_COUNTS)[number] = 256;
  private running = false;
  private disposed = false;
  private raf = 0;
  private width = 1;
  private height = 1;
  private frameIndex = 0;
  private startedAt = performance.now();
  private lastCpuBuildMs = 0;
  private referenceValid = true;
  private lastGpuOverflow: number | undefined;
  private readonly queryState: TimestampQueryState | undefined;

  private constructor(
    private readonly shell: DemoContext,
    private readonly device: GPUDevice,
    private readonly canvasContext: GPUCanvasContext,
    private readonly canvasFormat: GPUTextureFormat,
    gbufferPipeline: GPURenderPipeline,
    assignmentPipeline: GPUComputePipeline,
    lightingPipeline: GPURenderPipeline,
    lightBuffer: GPUBuffer,
    headerBuffer: GPUBuffer,
    indexBuffer: GPUBuffer,
    overflowBuffer: GPUBuffer,
    uniformBuffer: GPUBuffer,
    assignmentBindGroup: GPUBindGroup,
    assignmentReadback: ClusterAssignmentReadback,
    queryState: TimestampQueryState | undefined,
    private readonly onDeviceLost: (message: string) => void,
  ) {
    this.gbufferPipeline = gbufferPipeline;
    this.assignmentPipeline = assignmentPipeline;
    this.lightingPipeline = lightingPipeline;
    this.lightBuffer = lightBuffer;
    this.headerBuffer = headerBuffer;
    this.indexBuffer = indexBuffer;
    this.overflowBuffer = overflowBuffer;
    this.uniformBuffer = uniformBuffer;
    this.assignmentBindGroup = assignmentBindGroup;
    this.assignmentReadback = assignmentReadback;
    this.queryState = queryState;
  }

  static async create(
    shell: DemoContext,
    onDeviceLost: (message: string) => void,
  ): Promise<WebGpuClusteredLightingRenderer> {
    if (navigator.gpu === undefined) throw new Error("WebGPU is unavailable.");
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (adapter === null) throw new Error("No WebGPU adapter was returned.");
    const timestampRequested = adapter.features.has("timestamp-query");
    let timestampSupported = timestampRequested;
    let device: GPUDevice;
    try {
      device = await adapter.requestDevice({
        requiredFeatures: timestampRequested ? ["timestamp-query"] : [],
      });
    } catch (error) {
      if (timestampRequested === false) throw error;
      device = await adapter.requestDevice();
      timestampSupported = false;
    }
    const canvasContext = shell.canvas.getContext("webgpu");
    if (canvasContext === null) {
      device.destroy();
      throw new Error("The canvas could not create a WebGPU context.");
    }
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    try {
      const gbufferModule = device.createShaderModule({
        label: "ClusteredLighting/GBufferWGSL",
        code: GBUFFER_WGSL,
      });
      const lightingModule = device.createShaderModule({
        label: "ClusteredLighting/LightingWGSL",
        code: LIGHTING_WGSL,
      });
      const assignmentModule = device.createShaderModule({
        label: "ClusteredLighting/AssignmentWGSL",
        code: CLUSTER_ASSIGN_WGSL,
      });
      await assertShaderModule(gbufferModule, "G-buffer shader");
      await assertShaderModule(assignmentModule, "Cluster assignment shader");
      await assertShaderModule(lightingModule, "Lighting shader");
      const assignmentPipeline = await device.createComputePipelineAsync({
        label: "ClusteredLighting/AssignmentPipeline",
        layout: "auto",
        compute: { module: assignmentModule, entryPoint: "assign" },
      });
      const gbufferPipeline = await device.createRenderPipelineAsync({
        label: "ClusteredLighting/GBufferPipeline",
        layout: "auto",
        vertex: { module: gbufferModule, entryPoint: "vertex" },
        fragment: {
          module: gbufferModule,
          entryPoint: "fragment",
          targets: [{ format: "rgba8unorm" }, { format: "rgba16float" }],
        },
        primitive: { topology: "triangle-list" },
      });
      const lightingPipeline = await device.createRenderPipelineAsync({
        label: "ClusteredLighting/LightingPipeline",
        layout: "auto",
        vertex: { module: lightingModule, entryPoint: "vertex" },
        fragment: {
          module: lightingModule,
          entryPoint: "fragment",
          targets: [{ format: canvasFormat }],
        },
        primitive: { topology: "triangle-list" },
      });
      const lightBuffer = device.createBuffer({
        label: "ClusteredLighting/Lights",
        size: CLUSTER_LIGHT_COUNTS[2] * 8 * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      const headerBuffer = device.createBuffer({
        label: "ClusteredLighting/Headers",
        size: DEFAULT_CLUSTER_GRID.x * DEFAULT_CLUSTER_GRID.y * DEFAULT_CLUSTER_GRID.z * 8,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      });
      const indexBuffer = device.createBuffer({
        label: "ClusteredLighting/Indices",
        size:
          DEFAULT_CLUSTER_GRID.x *
          DEFAULT_CLUSTER_GRID.y *
          DEFAULT_CLUSTER_GRID.z *
          DEFAULT_CLUSTER_GRID.maxLightsPerCluster *
          Uint32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      });
      const overflowBuffer = device.createBuffer({
        label: "ClusteredLighting/Overflow",
        size: Uint32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      });
      const uniformBuffer = device.createBuffer({
        label: "ClusteredLighting/FrameUniforms",
        size: 48,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const assignmentBindGroup = device.createBindGroup({
        label: "ClusteredLighting/AssignmentBindGroup",
        layout: assignmentPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: lightBuffer } },
          { binding: 1, resource: { buffer: headerBuffer } },
          { binding: 2, resource: { buffer: indexBuffer } },
          { binding: 3, resource: { buffer: overflowBuffer } },
          { binding: 4, resource: { buffer: uniformBuffer } },
        ],
      });
      const assignmentReadback = ClusterAssignmentReadback.create(
        device,
        clusterCount(DEFAULT_CLUSTER_GRID) * 8,
        clusterCount(DEFAULT_CLUSTER_GRID) *
          DEFAULT_CLUSTER_GRID.maxLightsPerCluster *
          Uint32Array.BYTES_PER_ELEMENT,
      );
      let queryState: TimestampQueryState | undefined;
      if (timestampSupported) {
        try {
          queryState = TimestampQueryState.create(device);
        } catch {
          timestampSupported = false;
          queryState = undefined;
        }
      }
      const renderer = new WebGpuClusteredLightingRenderer(
        shell,
        device,
        canvasContext,
        canvasFormat,
        gbufferPipeline,
        assignmentPipeline,
        lightingPipeline,
        lightBuffer,
        headerBuffer,
        indexBuffer,
        overflowBuffer,
        uniformBuffer,
        assignmentBindGroup,
        assignmentReadback,
        queryState,
        onDeviceLost,
      );
      renderer.watchDeviceLoss();
      return renderer;
    } catch (error) {
      device.destroy();
      throw error;
    }
  }

  resize(width: number, height: number): void {
    if (this.disposed) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const nextWidth = Math.max(1, Math.floor(width * dpr));
    const nextHeight = Math.max(1, Math.floor(height * dpr));
    if (this.targets && this.width === nextWidth && this.height === nextHeight) return;
    const nextTargets = this.createTargets(nextWidth, nextHeight);
    const previous = this.targets;
    this.width = nextWidth;
    this.height = nextHeight;
    this.targets = nextTargets;
    this.shell.canvas.width = nextWidth;
    this.shell.canvas.height = nextHeight;
    this.canvasContext.configure({
      device: this.device,
      format: this.canvasFormat,
      alphaMode: "opaque",
    });
    previous?.albedo.destroy();
    previous?.normalDepth.destroy();
    this.renderOnce(performance.now());
  }

  setMode(mode: LightingMode): void {
    this.mode = mode;
    this.renderOnce(performance.now());
  }

  setLightCount(count: (typeof CLUSTER_LIGHT_COUNTS)[number]): void {
    this.lightCount = count;
    this.renderOnce(performance.now());
  }

  setView(view: ClusterView): void {
    this.view = view;
    this.renderOnce(performance.now());
  }

  pause(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  resume(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.raf = requestAnimationFrame(this.renderLoop);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pause();
    this.targets?.albedo.destroy();
    this.targets?.normalDepth.destroy();
    this.queryState?.dispose();
    this.assignmentReadback.dispose();
    this.lightBuffer.destroy();
    this.headerBuffer.destroy();
    this.indexBuffer.destroy();
    this.overflowBuffer.destroy();
    this.uniformBuffer.destroy();
    this.device.destroy();
  }

  private createTargets(width: number, height: number): Targets {
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
    const albedo = this.device.createTexture({
      label: "ClusteredLighting/GBufferAlbedo",
      size: [width, height],
      format: "rgba8unorm",
      usage,
    });
    try {
      return {
        albedo,
        normalDepth: this.device.createTexture({
          label: "ClusteredLighting/GBufferNormalDepth",
          size: [width, height],
          format: "rgba16float",
          usage,
        }),
      };
    } catch (error) {
      albedo.destroy();
      throw error;
    }
  }

  private renderOnce(now: number): void {
    if (this.disposed || this.targets === undefined) return;
    const elapsed = (now - this.startedAt) / 1000;
    const lights = buildDynamicLights(this.lightCount, elapsed);
    let cpuReference: ClusterBuildResult | undefined;
    if (this.lightCount === 64 && this.frameIndex % 120 === 0) {
      const started = performance.now();
      cpuReference = buildClusteredLightAssignments(lights, DEFAULT_CLUSTER_GRID);
      this.lastCpuBuildMs = Math.max(0, performance.now() - started);
      this.referenceValid = verifyClusteredLightAssignments(lights, cpuReference).valid;
    }
    this.device.queue.writeBuffer(this.lightBuffer, 0, packDynamicLights(lights));
    this.device.queue.writeBuffer(this.overflowBuffer, 0, new Uint32Array([0]));
    const uniforms = new Float32Array([
      this.width,
      this.height,
      elapsed,
      this.lightCount,
      MODE_INDEX[this.mode],
      VIEW_INDEX[this.view],
      DEFAULT_CLUSTER_GRID.x,
      DEFAULT_CLUSTER_GRID.y,
      DEFAULT_CLUSTER_GRID.near,
      DEFAULT_CLUSTER_GRID.far,
      DEFAULT_CLUSTER_GRID.z,
      DEFAULT_CLUSTER_GRID.maxLightsPerCluster,
    ]);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);
    const encoder = this.device.createCommandEncoder({ label: "ClusteredLighting/Frame" });
    this.encodeAssignment(encoder);
    this.encodeGBuffer(encoder);
    this.encodeLighting(encoder);
    this.queryState?.encodeResolve(encoder, this.frameIndex, (metrics) => {
      this.reportGpuEvidence(metrics);
    });
    this.assignmentReadback.encode(
      encoder,
      this.frameIndex,
      cpuReference,
      (result) => {
        this.lastGpuOverflow = result.overflow;
        if (result.comparison) this.referenceValid = result.comparison.valid;
      },
      this.headerBuffer,
      this.indexBuffer,
      this.overflowBuffer,
    );
    this.device.queue.submit([encoder.finish()]);
    this.queryState?.afterSubmit();
    this.assignmentReadback.afterSubmit();
    this.frameIndex += 1;
    this.reportEvidence();
  }

  private encodeAssignment(encoder: GPUCommandEncoder): void {
    const pass = encoder.beginComputePass(
      this.queryState?.computePassDescriptor ?? { label: "ClusteredLighting/AssignmentPass" },
    );
    pass.setPipeline(this.assignmentPipeline);
    pass.setBindGroup(0, this.assignmentBindGroup);
    pass.dispatchWorkgroups(clusterCount(DEFAULT_CLUSTER_GRID));
    pass.end();
  }

  private encodeGBuffer(encoder: GPUCommandEncoder): void {
    const targets = this.targets;
    if (targets === undefined) return;
    const pass = encoder.beginRenderPass({
      label: "ClusteredLighting/GBufferPass",
      timestampWrites: this.queryState?.geometryTimestampWrites,
      colorAttachments: [
        {
          view: targets.albedo.createView(),
          clearValue: [0, 0, 0, 1],
          loadOp: "clear",
          storeOp: "store",
        },
        {
          view: targets.normalDepth.createView(),
          clearValue: [0, 0, 1, 1],
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(this.gbufferPipeline);
    pass.setBindGroup(
      0,
      this.device.createBindGroup({
        layout: this.gbufferPipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
      }),
    );
    pass.draw(3);
    pass.end();
  }

  private encodeLighting(encoder: GPUCommandEncoder): void {
    const targets = this.targets;
    if (targets === undefined) return;
    const pass = encoder.beginRenderPass({
      label: "ClusteredLighting/LightingPass",
      timestampWrites: this.queryState?.lightingTimestampWrites,
      colorAttachments: [
        {
          view: this.canvasContext.getCurrentTexture().createView(),
          clearValue: [0.01, 0.02, 0.02, 1],
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(this.lightingPipeline);
    pass.setBindGroup(
      0,
      this.device.createBindGroup({
        layout: this.lightingPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: targets.albedo.createView() },
          { binding: 1, resource: targets.normalDepth.createView() },
          { binding: 2, resource: { buffer: this.lightBuffer } },
          { binding: 3, resource: { buffer: this.headerBuffer } },
          { binding: 4, resource: { buffer: this.indexBuffer } },
          { binding: 5, resource: { buffer: this.uniformBuffer } },
        ],
      }),
    );
    pass.draw(3);
    pass.end();
  }

  private reportEvidence(): void {
    const label =
      this.mode === "naive"
        ? "Naive all-lights baseline / GPU assignment diagnostic"
        : this.mode === "deferred"
          ? "Deferred all-lights baseline / GPU assignment diagnostic"
          : "Clustered GPU Compute optimized list";
    const verification = this.referenceValid ? "CPU reference valid" : "CPU/GPU reference mismatch";
    const overflow =
      this.lastGpuOverflow === undefined
        ? "GPU overflow pending readback"
        : "GPU overflow " + String(this.lastGpuOverflow);
    this.shell.setMetrics({
      backend: this.backendLabel,
      status:
        label +
        " | " +
        String(this.lightCount) +
        " lights | " +
        overflow +
        " | " +
        verification +
        " | GPU timing " +
        (this.queryState ? "pending timestamp" : "unavailable"),
      compileMs: this.lastCpuBuildMs > 0 ? Number(this.lastCpuBuildMs.toFixed(2)) : undefined,
      metricSource: this.lastCpuBuildMs > 0 ? "cpu-wall-clock" : "unavailable",
    });
  }

  private reportGpuEvidence(metrics: TimestampMetrics): void {
    this.shell.setMetrics({
      backend: this.backendLabel,
      status:
        "GPU geometry " +
        metrics.geometryMs.toFixed(2) +
        " ms | compute " +
        metrics.computeMs.toFixed(2) +
        " ms | lighting " +
        metrics.lightingMs.toFixed(2) +
        " ms | GPU overflow " +
        (this.lastGpuOverflow === undefined ? "pending readback" : String(this.lastGpuOverflow)),
      frameTimeMs: metrics.geometryMs + metrics.computeMs + metrics.lightingMs,
      compileMs: Number(this.lastCpuBuildMs.toFixed(2)),
      metricSource: "gpu-timestamp-query",
    });
  }

  private renderLoop = (now: number): void => {
    if (this.running === false || this.disposed) return;
    this.raf = 0;
    this.renderOnce(now);
    this.raf = requestAnimationFrame(this.renderLoop);
  };

  private watchDeviceLoss(): void {
    const recover = (reason: unknown) => {
      if (this.disposed) return;
      const info = reason as Partial<GPUDeviceLostInfo>;
      this.onDeviceLost(
        `WebGPU device lost (${info.reason || "unknown"}): ${info.message || "recovery required"}`,
      );
    };
    if (this.shell.onDeviceLost) this.shell.onDeviceLost(this.device, recover);
    else void this.device.lost.then(recover).catch(() => undefined);
  }
}

async function assertShaderModule(module: GPUShaderModule, label: string): Promise<void> {
  const compilation = await module.getCompilationInfo();
  const errors = compilation.messages.filter((message) => message.type === "error");
  if (errors.length > 0)
    throw new Error(`${label}: ${errors.map((entry) => entry.message).join(" | ")}`);
}

interface TimestampMetrics {
  geometryMs: number;
  computeMs: number;
  lightingMs: number;
}

interface AssignmentReadbackResult {
  overflow: number;
  comparison?: ReturnType<typeof compareFixedGpuClusterReadback>;
}

interface AssignmentReadbackSlot {
  headers: GPUBuffer;
  indices: GPUBuffer;
  overflow: GPUBuffer;
  busy: boolean;
}

class ClusterAssignmentReadback {
  private constructor(private readonly slots: AssignmentReadbackSlot[]) {}

  private pending:
    | {
        slot: AssignmentReadbackSlot;
        reference: ClusterBuildResult | undefined;
        report: (result: AssignmentReadbackResult) => void;
      }
    | undefined;

  static create(
    device: GPUDevice,
    headerBytes: number,
    indexBytes: number,
  ): ClusterAssignmentReadback {
    const slots: AssignmentReadbackSlot[] = [];
    try {
      for (let index = 0; index < 3; index += 1) {
        slots.push({
          headers: device.createBuffer({
            label: `ClusteredLighting/HeaderReadback${index}`,
            size: headerBytes,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
          }),
          indices: device.createBuffer({
            label: `ClusteredLighting/IndexReadback${index}`,
            size: indexBytes,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
          }),
          overflow: device.createBuffer({
            label: `ClusteredLighting/OverflowReadback${index}`,
            size: Uint32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
          }),
          busy: false,
        });
      }
      return new ClusterAssignmentReadback(slots);
    } catch (error) {
      slots.forEach((slot) => {
        slot.headers.destroy();
        slot.indices.destroy();
        slot.overflow.destroy();
      });
      throw error;
    }
  }

  encode(
    encoder: GPUCommandEncoder,
    frameIndex: number,
    reference: ClusterBuildResult | undefined,
    report: (result: AssignmentReadbackResult) => void,
    headers: GPUBuffer,
    indices: GPUBuffer,
    overflow: GPUBuffer,
  ): void {
    const deepCompare = reference !== undefined;
    const interval = deepCompare ? 120 : 15;
    if (frameIndex % interval !== 0) return;
    const slot = this.slots[Math.floor(frameIndex / interval) % this.slots.length];
    if (slot.busy) return;
    slot.busy = true;
    encoder.copyBufferToBuffer(overflow, 0, slot.overflow, 0, Uint32Array.BYTES_PER_ELEMENT);
    if (deepCompare) {
      encoder.copyBufferToBuffer(headers, 0, slot.headers, 0, slot.headers.size);
      encoder.copyBufferToBuffer(indices, 0, slot.indices, 0, slot.indices.size);
    }
    this.pending = { slot, reference, report };
  }

  afterSubmit(): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = undefined;
    const { slot, reference, report } = pending;
    void slot.overflow
      .mapAsync(GPUMapMode.READ)
      .then(async () => {
        const overflow = new Uint32Array(slot.overflow.getMappedRange().slice(0))[0];
        slot.overflow.unmap();
        if (!reference) {
          report({ overflow });
          return;
        }
        await Promise.all([
          slot.headers.mapAsync(GPUMapMode.READ),
          slot.indices.mapAsync(GPUMapMode.READ),
        ]);
        const headers = new Uint32Array(slot.headers.getMappedRange().slice(0));
        const indices = new Uint32Array(slot.indices.getMappedRange().slice(0));
        slot.headers.unmap();
        slot.indices.unmap();
        report({
          overflow,
          comparison: compareFixedGpuClusterReadback(reference, { headers, indices, overflow }),
        });
      })
      .catch(() => undefined)
      .finally(() => {
        slot.busy = false;
      });
  }

  dispose(): void {
    this.slots.forEach((slot) => {
      slot.headers.destroy();
      slot.indices.destroy();
      slot.overflow.destroy();
    });
  }
}

class TimestampQueryState {
  private constructor(
    private readonly querySet: GPUQuerySet,
    private readonly resolveBuffer: GPUBuffer,
    private readonly readbacks: GPUBuffer[],
  ) {}

  private readonly busy = [false, false, false];
  private pending: { slot: number; report: (metrics: TimestampMetrics) => void } | undefined;

  static create(device: GPUDevice): TimestampQueryState {
    let querySet: GPUQuerySet | undefined;
    let resolveBuffer: GPUBuffer | undefined;
    const readbacks: GPUBuffer[] = [];
    try {
      querySet = device.createQuerySet({ type: "timestamp", count: 6 });
      resolveBuffer = device.createBuffer({
        label: "ClusteredLighting/TimestampResolve",
        size: 48,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
      });
      for (let index = 0; index < 3; index += 1) {
        readbacks.push(
          device.createBuffer({
            label: `ClusteredLighting/TimestampReadback${index}`,
            size: 48,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
          }),
        );
      }
      return new TimestampQueryState(querySet, resolveBuffer, readbacks);
    } catch (error) {
      querySet?.destroy();
      resolveBuffer?.destroy();
      readbacks.forEach((buffer) => buffer.destroy());
      throw error;
    }
  }

  get geometryTimestampWrites(): GPURenderPassTimestampWrites {
    return {
      querySet: this.querySet,
      beginningOfPassWriteIndex: 0,
      endOfPassWriteIndex: 1,
    };
  }

  get computePassDescriptor(): GPUComputePassDescriptor {
    return {
      label: "ClusteredLighting/AssignmentPass",
      timestampWrites: {
        querySet: this.querySet,
        beginningOfPassWriteIndex: 2,
        endOfPassWriteIndex: 3,
      },
    };
  }

  get lightingTimestampWrites(): GPURenderPassTimestampWrites {
    return {
      querySet: this.querySet,
      beginningOfPassWriteIndex: 4,
      endOfPassWriteIndex: 5,
    };
  }

  encodeResolve(
    encoder: GPUCommandEncoder,
    frameIndex: number,
    report: (metrics: TimestampMetrics) => void,
  ): void {
    encoder.resolveQuerySet(this.querySet, 0, 6, this.resolveBuffer, 0);
    const slot = frameIndex % this.readbacks.length;
    if (this.busy[slot] || frameIndex % 20 !== 0) return;
    this.busy[slot] = true;
    encoder.copyBufferToBuffer(this.resolveBuffer, 0, this.readbacks[slot], 0, 48);
    this.pending = { slot, report };
  }

  afterSubmit(): void {
    const pending = this.pending;
    if (pending === undefined) return;
    this.pending = undefined;
    const readback = this.readbacks[pending.slot];
    void readback
      .mapAsync(GPUMapMode.READ)
      .then(() => {
        const values = new BigUint64Array(readback.getMappedRange().slice(0));
        readback.unmap();
        pending.report({
          geometryMs: Number(values[1] - values[0]) / 1_000_000,
          computeMs: Number(values[3] - values[2]) / 1_000_000,
          lightingMs: Number(values[5] - values[4]) / 1_000_000,
        });
      })
      .catch(() => undefined)
      .finally(() => {
        this.busy[pending.slot] = false;
      });
  }

  dispose(): void {
    this.querySet.destroy();
    this.resolveBuffer.destroy();
    this.readbacks.forEach((buffer) => buffer.destroy());
  }
}
