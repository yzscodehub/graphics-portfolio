import { createMetricReporter, drawStageBackdrop, resizeCanvas } from "./core/canvas";
import type { DemoContext } from "./core/types";

export const VISIBILITY_COUNTS = [10_000, 50_000, 100_000] as const;
export const INDEXED_INDIRECT_STRIDE_BYTES = 32;
export const LOD_INDEX_COUNTS = [18, 12, 6] as const;
export const LOD_FIRST_INDICES = [0, 18, 30] as const;
export const LOD_COUNT = LOD_INDEX_COUNTS.length;
export const INDIRECT_COMMAND_WORDS = INDEXED_INDIRECT_STRIDE_BYTES / Uint32Array.BYTES_PER_ELEMENT;
const INSTANCE_STRIDE_FLOATS = 8;
const READBACK_INTERVAL = 30;

export type VisibilityExecution = "cpu" | "gpu";
export type VisibilityRuntimeKind = "cpu-baseline" | "webgpu" | "fallback";

export interface VisibilityFrustum {
  left: number;
  right: number;
  bottom: number;
  top: number;
  near: number;
  far: number;
}

export const DEFAULT_VISIBILITY_FRUSTUM: Readonly<VisibilityFrustum> = {
  left: -11,
  right: 11,
  bottom: -6.2,
  top: 6.2,
  near: 0.25,
  far: 20,
};

export interface VisibilityInstance {
  id: number;
  position: readonly [number, number, number];
  radius: number;
  color: readonly [number, number, number];
}

export interface VisibilityReference {
  visibleIndices: Uint32Array;
  lodIndices: readonly [Uint32Array, Uint32Array, Uint32Array];
  lodCounts: readonly [number, number, number];
  indirectCommands: readonly [Uint32Array, Uint32Array, Uint32Array];
}

export interface VisibilityCommandEvidence {
  tested: number;
  visible: number;
  lodCounts: readonly [number, number, number];
  commands: readonly [Uint32Array, Uint32Array, Uint32Array];
  valid: boolean;
}

export interface VisibilityRenderer {
  readonly runtimeKind: VisibilityRuntimeKind;
  resize(): void;
  setCameraSweep(active: boolean): void;
  pause(): void;
  resume(): void;
  reset(): void;
  dispose(): void;
}

interface Destroyable {
  destroy?(): void;
}

export class VisibilityResourceScope {
  private readonly resources: Destroyable[] = [];
  private disposed = false;

  track<T extends Destroyable>(resource: T): T {
    if (this.disposed) {
      resource.destroy?.();
      return resource;
    }
    this.resources.push(resource);
    return resource;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const resource of this.resources.splice(0).reverse()) resource.destroy?.();
  }
}

export function createVisibilityInstance(index: number): VisibilityInstance {
  const x = (hash(index * 17.17) - 0.5) * 34;
  const z = 0.25 + hash(index * 47.71 + 3) * 25;
  const y = (hash(index * 91.19 + 7) - 0.5) * 12 + Math.sin(index * 0.37) * 0.4;
  const radius = 0.16 + hash(index * 31.07 + 11) * 0.58;
  const palette: ReadonlyArray<readonly [number, number, number]> = [
    [0.34, 0.89, 0.76],
    [0.96, 0.54, 0.16],
    [0.82, 0.86, 0.8],
  ];
  return { id: index, position: [x, y, z], radius, color: palette[index % palette.length] };
}

export function createVisibilityInstances(count: number): VisibilityInstance[] {
  return Array.from({ length: count }, (_, index) => createVisibilityInstance(index));
}

export function createVisibilityInstanceData(count: number): Float32Array {
  const data = new Float32Array(count * INSTANCE_STRIDE_FLOATS);
  for (let index = 0; index < count; index += 1) {
    const item = createVisibilityInstance(index);
    data.set([...item.position, item.radius, ...item.color, 0], index * INSTANCE_STRIDE_FLOATS);
  }
  return data;
}

/** Sphere/frustum intersection; an object touching a plane remains visible. */
export function isInstanceVisible(
  item: Pick<VisibilityInstance, "position" | "radius">,
  frustum: VisibilityFrustum = DEFAULT_VISIBILITY_FRUSTUM,
): boolean {
  const [x, y, z] = item.position;
  const radius = Math.max(0, item.radius);
  return !(
    x + radius < frustum.left ||
    x - radius > frustum.right ||
    y + radius < frustum.bottom ||
    y - radius > frustum.top ||
    z + radius < frustum.near ||
    z - radius > frustum.far
  );
}

export function lodForInstance(
  item: Pick<VisibilityInstance, "position">,
  frustum: VisibilityFrustum = DEFAULT_VISIBILITY_FRUSTUM,
): 0 | 1 | 2 {
  const [x, y, z] = item.position;
  const cameraX = frustum.left - DEFAULT_VISIBILITY_FRUSTUM.left;
  const distance = Math.hypot((x - cameraX) * 0.45, y * 0.45, z - frustum.near);
  return distance < 7.5 ? 0 : distance < 14 ? 1 : 2;
}

export function createIndexedIndirectCommand(
  indexCount: number,
  instanceCount: number,
): Uint32Array {
  const words = new Uint32Array(INDIRECT_COMMAND_WORDS);
  words[0] = Math.max(0, Math.floor(indexCount));
  words[1] = Math.max(0, Math.floor(instanceCount));
  // firstIndex, baseVertex and firstInstance stay zero; the latter is our compatibility invariant.
  return words;
}

export function createLodIndirectCommands(
  lodCounts: readonly [number, number, number],
): [Uint32Array, Uint32Array, Uint32Array] {
  return LOD_INDEX_COUNTS.map((indexCount, lod) => {
    const command = createIndexedIndirectCommand(indexCount, lodCounts[lod]);
    command[2] = LOD_FIRST_INDICES[lod];
    return command;
  }) as [Uint32Array, Uint32Array, Uint32Array];
}

export function packLodIndirectCommands(lodCounts: readonly [number, number, number]): Uint32Array {
  const packed = new Uint32Array(LOD_COUNT * INDIRECT_COMMAND_WORDS);
  createLodIndirectCommands(lodCounts).forEach((command, lod) =>
    packed.set(command, lod * INDIRECT_COMMAND_WORDS),
  );
  return packed;
}

export function frustumForCamera(cameraX = 0): VisibilityFrustum {
  return {
    ...DEFAULT_VISIBILITY_FRUSTUM,
    left: DEFAULT_VISIBILITY_FRUSTUM.left + cameraX,
    right: DEFAULT_VISIBILITY_FRUSTUM.right + cameraX,
  };
}

export function buildVisibilityReference(
  items: readonly VisibilityInstance[],
  frustum: VisibilityFrustum = DEFAULT_VISIBILITY_FRUSTUM,
): VisibilityReference {
  const lodLists: [number[], number[], number[]] = [[], [], []];
  const lodCounts: [number, number, number] = [0, 0, 0];
  for (const item of items) {
    if (!isInstanceVisible(item, frustum)) continue;
    const lod = lodForInstance(item, frustum);
    lodLists[lod].push(item.id);
    lodCounts[lod] += 1;
  }
  const lodIndices: VisibilityReference["lodIndices"] = [
    new Uint32Array(lodLists[0]),
    new Uint32Array(lodLists[1]),
    new Uint32Array(lodLists[2]),
  ];
  return {
    visibleIndices: new Uint32Array(lodLists.flat()),
    lodIndices,
    lodCounts,
    indirectCommands: createLodIndirectCommands(lodCounts),
  };
}

export function validateVisibilityCommandReadback(
  values: Uint32Array,
  expectedTested?: number,
): VisibilityCommandEvidence {
  const commands = Array.from({ length: LOD_COUNT }, (_, lod) =>
    values.slice(lod * INDIRECT_COMMAND_WORDS, (lod + 1) * INDIRECT_COMMAND_WORDS),
  ) as [Uint32Array, Uint32Array, Uint32Array];
  const statsOffset = LOD_COUNT * INDIRECT_COMMAND_WORDS;
  const tested = values[statsOffset] ?? 0;
  const visible = values[statsOffset + 1] ?? 0;
  const lodCounts: [number, number, number] = [
    values[statsOffset + 2] ?? 0,
    values[statsOffset + 3] ?? 0,
    values[statsOffset + 4] ?? 0,
  ];
  const valid =
    commands.every(
      (command, lod) =>
        command.length === INDIRECT_COMMAND_WORDS &&
        command[0] === LOD_INDEX_COUNTS[lod] &&
        command[1] === lodCounts[lod] &&
        command[2] === LOD_FIRST_INDICES[lod] &&
        command[3] === 0 &&
        command[4] === 0,
    ) &&
    visible === lodCounts.reduce((sum, count) => sum + count, 0) &&
    (expectedTested === undefined || tested === expectedTested);
  return { tested, visible, lodCounts, commands, valid };
}

export async function createVisibilityRenderer(
  shell: DemoContext,
  count: number,
  execution: VisibilityExecution,
  onDeviceLost: (message: string) => void,
): Promise<VisibilityRenderer> {
  if (execution === "cpu") return new CanvasVisibilityRenderer(shell, count, "cpu-baseline");
  try {
    return await WebGpuVisibilityRenderer.create(shell, count, onDeviceLost);
  } catch {
    return new CanvasVisibilityRenderer(shell, count, "fallback");
  }
}

export function createVisibilityFallbackRenderer(
  shell: DemoContext,
  count: number,
): VisibilityRenderer {
  return new CanvasVisibilityRenderer(shell, count, "fallback");
}

// CANVAS_VISIBILITY_RENDERER_FOLLOWS
class CanvasVisibilityRenderer implements VisibilityRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly items: VisibilityInstance[];
  private reference: VisibilityReference;
  private readonly report: ReturnType<typeof createMetricReporter>;
  private context2d: CanvasRenderingContext2D;
  private raf = 0;
  private running = false;
  private cameraSweep = false;
  private cameraX = 0;

  constructor(
    private readonly shell: DemoContext,
    count: number,
    readonly runtimeKind: VisibilityRuntimeKind,
  ) {
    this.items = createVisibilityInstances(count);
    this.reference = buildVisibilityReference(this.items);
    this.canvas = mountFallbackCanvas(shell, "Deterministic visibility heatmap.");
    this.context2d = resizeCanvas(this.canvas, shell.stage.clientWidth, shell.stage.clientHeight);
    this.report = createMetricReporter(shell);
  }

  resize(): void {
    this.context2d = resizeCanvas(
      this.canvas,
      this.shell.stage.clientWidth,
      this.shell.stage.clientHeight,
    );
  }

  setCameraSweep(active: boolean): void {
    this.cameraSweep = active;
  }

  pause(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  resume(): void {
    if (this.running) return;
    this.running = true;
    this.schedule();
  }

  reset(): void {
    this.cameraX = 0;
    if (this.running) this.render();
  }

  dispose(): void {
    this.pause();
    this.canvas.remove();
    this.shell.canvas.hidden = false;
  }

  private render = (now = performance.now()): void => {
    if (!this.running) return;
    this.raf = 0;
    const { width, height } = this.shell.stage.getBoundingClientRect();
    if (this.cameraSweep) this.cameraX = Math.sin(now * 0.00055) * 7;
    const cullStarted = performance.now();
    const frustum = frustumForCamera(this.cameraX);
    this.reference = buildVisibilityReference(this.items, frustum);
    const cullingMs = performance.now() - cullStarted;
    drawStageBackdrop(this.context2d, width, height);
    const visible = new Set<number>(this.reference.visibleIndices);
    const stride = Math.max(1, Math.ceil(this.items.length / 4_000));
    for (let index = 0; index < this.items.length; index += stride) {
      const item = this.items[index];
      const x = ((item.position[0] - frustum.left) / (frustum.right - frustum.left)) * width;
      const y =
        height - ((item.position[1] - frustum.bottom) / (frustum.top - frustum.bottom)) * height;
      const isVisible = visible.has(item.id);
      this.context2d.fillStyle = isVisible ? "rgba(87,227,194,.65)" : "rgba(151,74,43,.25)";
      this.context2d.fillRect(x, y, isVisible ? 2 : 1, isVisible ? 2 : 1);
    }
    this.context2d.fillStyle = "#e8e6dc";
    this.context2d.font = "12px ui-monospace, monospace";
    const label = this.runtimeKind === "fallback" ? "CANVAS FALLBACK" : "CPU BASELINE";
    this.context2d.fillText(
      `${label}: ${this.reference.visibleIndices.length.toLocaleString()} VISIBLE / LOD ${this.reference.lodCounts.join("/")}`,
      16,
      24,
    );
    this.report({
      backend: this.runtimeKind === "fallback" ? "Canvas fallback" : "CPU baseline / Canvas",
      status: `${this.reference.visibleIndices.length.toLocaleString()} visible / LOD ${this.reference.lodCounts.join("/")} / CPU cull ${cullingMs.toFixed(2)} ms`,
      compileMs: Number(cullingMs.toFixed(2)),
      metricSource: "cpu-wall-clock",
    });
    this.schedule();
  };

  private schedule(): void {
    if (!this.running || this.raf) return;
    this.raf = requestAnimationFrame(this.render);
  }
}

// WEBGPU_VISIBILITY_RENDERER_FOLLOWS
class WebGpuVisibilityRenderer implements VisibilityRenderer {
  readonly runtimeKind = "webgpu" as const;
  private readonly resources = new VisibilityResourceScope();
  private readonly report: ReturnType<typeof createMetricReporter>;
  private raf = 0;
  private running = false;
  private disposed = false;
  private frame = 0;
  private evidenceBusy = false;
  private cameraSweep = false;
  private cameraX = 0;
  private latestEvidence: VisibilityCommandEvidence = {
    tested: 0,
    visible: 0,
    lodCounts: [0, 0, 0],
    commands: createLodIndirectCommands([0, 0, 0]),
    valid: false,
  };

  private constructor(
    private readonly shell: DemoContext,
    private readonly adapter: GPUAdapter,
    private readonly device: GPUDevice,
    private readonly context: GPUCanvasContext,
    private readonly format: GPUTextureFormat,
    private readonly count: number,
    private readonly cameraBuffer: GPUBuffer,
    private readonly indirectBuffer: GPUBuffer,
    private readonly statsBuffer: GPUBuffer,
    private readonly statsReadback: GPUBuffer,
    private readonly indexBuffer: GPUBuffer,
    private readonly computePipeline: GPUComputePipeline,
    private readonly renderPipeline: GPURenderPipeline,
    private readonly computeBindGroup: GPUBindGroup,
    private readonly renderBindGroups: readonly [GPUBindGroup, GPUBindGroup, GPUBindGroup],
    private readonly timestamps: VisibilityTimestampState | undefined,
  ) {
    this.report = createMetricReporter(shell);
  }

  static async create(
    shell: DemoContext,
    count: number,
    onDeviceLost: (message: string) => void,
  ): Promise<WebGpuVisibilityRenderer> {
    if (!navigator.gpu) throw new Error("WebGPU is unavailable.");
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) throw new Error("No WebGPU adapter was returned.");
    const requestedTimestamps = adapter.features.has("timestamp-query");
    let device: GPUDevice;
    try {
      device = await adapter.requestDevice({
        requiredFeatures: requestedTimestamps ? ["timestamp-query"] : [],
      });
    } catch (error) {
      if (!requestedTimestamps) throw error;
      device = await adapter.requestDevice();
    }
    const allocations: GPUBuffer[] = [];
    let timestamps: VisibilityTimestampState | undefined;
    try {
      const context = shell.canvas.getContext("webgpu");
      if (!context) throw new Error("The canvas could not create a WebGPU context.");
      const format = navigator.gpu.getPreferredCanvasFormat();
      const createBuffer = (descriptor: GPUBufferDescriptor) => {
        const buffer = device.createBuffer(descriptor);
        allocations.push(buffer);
        return buffer;
      };
      const data = createVisibilityInstanceData(count);
      const instanceBuffer = createBuffer({
        label: "Visibility/Instances",
        size: data.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(instanceBuffer, 0, data);
      const visibleIndexBuffer = createBuffer({
        label: "Visibility/CompactedLodIndices",
        size: count * LOD_COUNT * Uint32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.STORAGE,
      });
      const cameraBuffer = createBuffer({
        label: "Visibility/Camera",
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const indirectBuffer = createBuffer({
        label: "Visibility/LodIndexedIndirect32",
        size: LOD_COUNT * INDEXED_INDIRECT_STRIDE_BYTES,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
      });
      const statsBuffer = createBuffer({
        label: "Visibility/AtomicStats",
        size: 20,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      });
      const statsReadback = createBuffer({
        label: "Visibility/StatsReadback",
        size: LOD_COUNT * INDEXED_INDIRECT_STRIDE_BYTES + 20,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const indexBuffer = createBuffer({
        label: "Visibility/LodIndexRanges",
        size: 36 * Uint32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(indexBuffer, 0, LOD_INDEX_DATA);
      const computeModule = device.createShaderModule({
        label: "Visibility/CullWGSL",
        code: CULL_WGSL,
      });
      const renderModule = device.createShaderModule({
        label: "Visibility/DrawWGSL",
        code: DRAW_WGSL,
      });
      await assertShaderModule(computeModule, "Visibility culling shader");
      await assertShaderModule(renderModule, "Visibility draw shader");
      const computePipeline = await device.createComputePipelineAsync({
        label: "Visibility/FrustumCompaction",
        layout: "auto",
        compute: { module: computeModule, entryPoint: "main" },
      });
      const renderPipeline = await device.createRenderPipelineAsync({
        label: "Visibility/IndirectRender",
        layout: "auto",
        vertex: { module: renderModule, entryPoint: "vs" },
        fragment: { module: renderModule, entryPoint: "fs", targets: [{ format }] },
        primitive: { topology: "triangle-list" },
      });
      const computeBindGroup = device.createBindGroup({
        layout: computePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: instanceBuffer } },
          { binding: 1, resource: { buffer: visibleIndexBuffer } },
          { binding: 2, resource: { buffer: indirectBuffer } },
          { binding: 3, resource: { buffer: statsBuffer } },
          { binding: 4, resource: { buffer: cameraBuffer } },
        ],
      });
      const lodUniformBuffers = LOD_INDEX_COUNTS.map((_, lod) => {
        const buffer = createBuffer({
          label: `Visibility/Lod${lod}DrawUniform`,
          size: 16,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(buffer, 0, new Uint32Array([lod, 0, 0, 0]));
        return buffer;
      }) as [GPUBuffer, GPUBuffer, GPUBuffer];
      const renderBindGroups = LOD_INDEX_COUNTS.map((_, lod) =>
        device.createBindGroup({
          layout: renderPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: instanceBuffer } },
            { binding: 1, resource: { buffer: visibleIndexBuffer } },
            { binding: 2, resource: { buffer: lodUniformBuffers[lod] } },
            { binding: 3, resource: { buffer: cameraBuffer } },
          ],
        }),
      ) as [GPUBindGroup, GPUBindGroup, GPUBindGroup];
      if (requestedTimestamps) {
        try {
          timestamps = VisibilityTimestampState.create(device);
        } catch {
          timestamps = undefined;
        }
      }
      const renderer = new WebGpuVisibilityRenderer(
        shell,
        adapter,
        device,
        context,
        format,
        count,
        cameraBuffer,
        indirectBuffer,
        statsBuffer,
        statsReadback,
        indexBuffer,
        computePipeline,
        renderPipeline,
        computeBindGroup,
        renderBindGroups,
        timestamps,
      );
      allocations.forEach((resource) => renderer.resources.track(resource));
      renderer.resize();
      void device.lost.then((info) => {
        if (!renderer.disposed)
          onDeviceLost(
            `WebGPU visibility device lost (${info.reason}): ${info.message || "recovery required"}`,
          );
      });
      shell.setMetrics({
        backend: renderer.backendLabel,
        status: timestamps
          ? "Compute culling + GPU timestamps ready"
          : "Compute culling ready; GPU timing N/A",
        metricSource: timestamps ? "gpu-timestamp-query" : "animation-frame",
      });
      return renderer;
    } catch (error) {
      timestamps?.dispose();
      allocations.forEach((buffer) => buffer.destroy());
      device.destroy();
      throw error;
    }
  }

  // WEBGPU_VISIBILITY_CREATE_COMPLETE
  resize(): void {
    const bounds = this.shell.stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.shell.canvas.width = Math.max(1, Math.floor(bounds.width * dpr));
    this.shell.canvas.height = Math.max(1, Math.floor(bounds.height * dpr));
    this.context.configure({ device: this.device, format: this.format, alphaMode: "opaque" });
  }

  setCameraSweep(active: boolean): void {
    this.cameraSweep = active;
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

  reset(): void {
    this.frame = 0;
    this.cameraX = 0;
    this.latestEvidence = {
      tested: 0,
      visible: 0,
      lodCounts: [0, 0, 0],
      commands: createLodIndirectCommands([0, 0, 0]),
      valid: false,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pause();
    this.timestamps?.dispose();
    this.resources.dispose();
    this.device.destroy();
  }

  private render = (now = performance.now()): void => {
    if (!this.running || this.disposed) return;
    this.raf = 0;
    if (this.cameraSweep) this.cameraX = Math.sin(now * 0.00055) * 7;
    this.device.queue.writeBuffer(this.cameraBuffer, 0, new Float32Array([this.cameraX, 0, 0, 0]));
    this.device.queue.writeBuffer(this.indirectBuffer, 0, packLodIndirectCommands([0, 0, 0]));
    this.device.queue.writeBuffer(this.statsBuffer, 0, new Uint32Array(5));
    const encoder = this.device.createCommandEncoder({ label: `Visibility/Frame${this.frame}` });
    const compute = encoder.beginComputePass(
      this.timestamps?.computeDescriptor ?? { label: "Visibility/ComputeCull" },
    );
    compute.setPipeline(this.computePipeline);
    compute.setBindGroup(0, this.computeBindGroup);
    compute.dispatchWorkgroups(Math.ceil(this.count / 64));
    compute.end();
    const pass = encoder.beginRenderPass({
      label: "Visibility/IndirectDraw",
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0.02, g: 0.055, b: 0.06, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
      timestampWrites: this.timestamps?.renderWrites,
    });
    pass.setPipeline(this.renderPipeline);
    pass.setIndexBuffer(this.indexBuffer, "uint32");
    for (let lod = 0; lod < LOD_COUNT; lod += 1) {
      pass.setBindGroup(0, this.renderBindGroups[lod]);
      pass.drawIndexedIndirect(this.indirectBuffer, lod * INDEXED_INDIRECT_STRIDE_BYTES);
    }
    pass.end();
    const readEvidence = this.frame % READBACK_INTERVAL === 0 && !this.evidenceBusy;
    if (readEvidence) {
      this.evidenceBusy = true;
      encoder.copyBufferToBuffer(
        this.indirectBuffer,
        0,
        this.statsReadback,
        0,
        LOD_COUNT * INDEXED_INDIRECT_STRIDE_BYTES,
      );
      encoder.copyBufferToBuffer(
        this.statsBuffer,
        0,
        this.statsReadback,
        LOD_COUNT * INDEXED_INDIRECT_STRIDE_BYTES,
        20,
      );
    }
    this.timestamps?.encodeResolve(encoder, this.frame, (metrics) => this.publish(metrics));
    this.device.queue.submit([encoder.finish()]);
    this.timestamps?.afterSubmit();
    if (readEvidence) this.readEvidence();
    if (!this.timestamps)
      this.report({
        backend: this.backendLabel,
        status: this.statusLabel(),
        metricSource: "animation-frame",
      });
    this.frame += 1;
    this.schedule();
  };

  // WEBGPU_VISIBILITY_RENDER_COMPLETE
  private get backendLabel(): string {
    return `Raw WebGPU / ${this.adapter.info?.device || this.adapter.info?.architecture || "adapter"}`;
  }

  private statusLabel(): string {
    const { tested, visible, lodCounts, valid } = this.latestEvidence;
    return `${tested.toLocaleString()} tested / ${visible.toLocaleString()} visible / LOD ${lodCounts.join("/")} / 3 indirect commands ${valid ? "verified" : "pending"}`;
  }

  private publish(metrics: VisibilityTimestampMetrics): void {
    this.shell.setMetrics({
      backend: this.backendLabel,
      status: `${this.statusLabel()} / compute ${metrics.computeMs.toFixed(2)} ms / draw ${metrics.renderMs.toFixed(2)} ms`,
      frameTimeMs: metrics.computeMs + metrics.renderMs,
      metricSource: "gpu-timestamp-query",
    });
  }

  private readEvidence(): void {
    void this.statsReadback
      .mapAsync(GPUMapMode.READ)
      .then(() => {
        const values = new Uint32Array(this.statsReadback.getMappedRange().slice(0));
        this.latestEvidence = validateVisibilityCommandReadback(values, this.count);
        this.statsReadback.unmap();
      })
      .catch(() => undefined)
      .finally(() => {
        this.evidenceBusy = false;
      });
  }

  private schedule(): void {
    if (!this.running || this.disposed || this.raf) return;
    this.raf = requestAnimationFrame(this.render);
  }
}

interface VisibilityTimestampMetrics {
  computeMs: number;
  renderMs: number;
}

class VisibilityTimestampState {
  private constructor(
    private readonly querySet: GPUQuerySet,
    private readonly resolveBuffer: GPUBuffer,
    private readonly readback: GPUBuffer,
  ) {}
  private busy = false;
  private pendingReport: ((metrics: VisibilityTimestampMetrics) => void) | undefined;

  static create(device: GPUDevice): VisibilityTimestampState {
    const querySet = device.createQuerySet({ type: "timestamp", count: 4 });
    const resolveBuffer = device.createBuffer({
      label: "Visibility/TimestampResolve",
      size: 32,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    const readback = device.createBuffer({
      label: "Visibility/TimestampReadback",
      size: 32,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    return new VisibilityTimestampState(querySet, resolveBuffer, readback);
  }

  get computeDescriptor(): GPUComputePassDescriptor {
    return {
      label: "Visibility/ComputeCull",
      timestampWrites: {
        querySet: this.querySet,
        beginningOfPassWriteIndex: 0,
        endOfPassWriteIndex: 1,
      },
    };
  }

  get renderWrites(): GPURenderPassTimestampWrites {
    return { querySet: this.querySet, beginningOfPassWriteIndex: 2, endOfPassWriteIndex: 3 };
  }

  encodeResolve(
    encoder: GPUCommandEncoder,
    frame: number,
    report: (metrics: VisibilityTimestampMetrics) => void,
  ): void {
    encoder.resolveQuerySet(this.querySet, 0, 4, this.resolveBuffer, 0);
    if (this.busy || frame % READBACK_INTERVAL !== 0) return;
    this.busy = true;
    encoder.copyBufferToBuffer(this.resolveBuffer, 0, this.readback, 0, 32);
    this.pendingReport = report;
  }

  afterSubmit(): void {
    const report = this.pendingReport;
    if (!report) return;
    this.pendingReport = undefined;
    void this.readback
      .mapAsync(GPUMapMode.READ)
      .then(() => {
        const values = new BigUint64Array(this.readback.getMappedRange().slice(0));
        this.readback.unmap();
        report({
          computeMs: Number(values[1] - values[0]) / 1_000_000,
          renderMs: Number(values[3] - values[2]) / 1_000_000,
        });
      })
      .catch(() => undefined)
      .finally(() => {
        this.busy = false;
      });
  }

  dispose(): void {
    this.querySet.destroy();
    this.resolveBuffer.destroy();
    this.readback.destroy();
  }
}

// VISIBILITY_SHADERS_FOLLOW
const CULL_WGSL = /* wgsl */ `
struct Instance { positionRadius: vec4f, color: vec4f }
@group(0) @binding(0) var<storage, read> instances: array<Instance>;
@group(0) @binding(1) var<storage, read_write> visibleIndices: array<u32>;
// Three 32-byte indexed-indirect slots. Atomic writes update instanceCount only.
@group(0) @binding(2) var<storage, read_write> indirect: array<atomic<u32>>;
// tested, visible, lod0, lod1, lod2
@group(0) @binding(3) var<storage, read_write> stats: array<atomic<u32>>;
struct Camera { offsetX: f32, _pad0: f32, _pad1: f32, _pad2: f32 }
@group(0) @binding(4) var<uniform> camera: Camera;

fn visible(position: vec3f, radius: f32) -> bool {
  return position.x + radius >= -11.0 + camera.offsetX && position.x - radius <= 11.0 + camera.offsetX &&
    position.y + radius >= -6.2 && position.y - radius <= 6.2 &&
    position.z + radius >= 0.25 && position.z - radius <= 20.0;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= arrayLength(&instances)) { return; }
  atomicAdd(&stats[0], 1u);
  let item = instances[id.x];
  if (!visible(item.positionRadius.xyz, item.positionRadius.w)) { return; }
  let distance = length(vec3f((item.positionRadius.x - camera.offsetX) * 0.45, item.positionRadius.y * 0.45, item.positionRadius.z - 0.25));
  var lod = 2u;
  if (distance < 7.5) { lod = 0u; }
  else if (distance < 14.0) { lod = 1u; }
  let output = atomicAdd(&indirect[lod * 8u + 1u], 1u);
  let segment = lod * arrayLength(&instances);
  visibleIndices[segment + output] = id.x;
  atomicAdd(&stats[1], 1u);
  atomicAdd(&stats[lod + 2u], 1u);
}
`;

const DRAW_WGSL = /* wgsl */ `
struct Instance { positionRadius: vec4f, color: vec4f }
@group(0) @binding(0) var<storage, read> instances: array<Instance>;
@group(0) @binding(1) var<storage, read> visibleIndices: array<u32>;
struct DrawLod { lod: u32, _pad0: u32, _pad1: u32, _pad2: u32 }
@group(0) @binding(2) var<uniform> drawLod: DrawLod;
struct Camera { offsetX: f32, _pad0: f32, _pad1: f32, _pad2: f32 }
@group(0) @binding(3) var<uniform> camera: Camera;
struct VertexOut { @builtin(position) position: vec4f, @location(0) color: vec3f }

@vertex fn vs(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> VertexOut {
  let item = instances[visibleIndices[drawLod.lod * arrayLength(&instances) + instance]];
  var vertices = array<vec2f, 18>(
    vec2f(0.0, -1.0), vec2f(0.7, -0.7), vec2f(1.0, 0.0), vec2f(0.7, 0.7),
    vec2f(0.0, 1.0), vec2f(-0.7, 0.7), vec2f(-1.0, 0.0), vec2f(-0.7, -0.7),
    vec2f(0.0, -1.0), vec2f(0.86, -0.5), vec2f(0.86, 0.5), vec2f(0.0, 1.0),
    vec2f(-0.86, 0.5), vec2f(-0.86, -0.5), vec2f(-1.0, -1.0), vec2f(1.0, -1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, 1.0)
  );
  let lodScale = select(select(0.68, 0.84, drawLod.lod == 1u), 1.0, drawLod.lod == 0u);
  let position = vec2f((item.positionRadius.x - camera.offsetX) / 11.0, item.positionRadius.y / 6.2) + vertices[vertex] * item.positionRadius.w * 0.045 * lodScale;
  var out: VertexOut;
  out.position = vec4f(position, 0.0, 1.0);
  let tint = select(select(vec3f(0.55, 0.72, 0.98), vec3f(0.94, 0.62, 0.24), drawLod.lod == 1u), item.color.rgb, drawLod.lod == 0u);
  out.color = tint * (0.45 + 0.55 * clamp(1.0 - item.positionRadius.z / 20.0, 0.0, 1.0));
  return out;
}
@fragment fn fs(input: VertexOut) -> @location(0) vec4f { return vec4f(input.color, 1.0); }
`;

const LOD_INDEX_DATA = new Uint32Array([
  0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5, 0, 5, 6, 0, 6, 7, 8, 9, 10, 8, 10, 11, 8, 11, 12, 8, 12, 13,
  14, 15, 16, 16, 15, 17,
]);

function hash(value: number): number {
  return Math.abs(Math.sin(value * 12.9898) * 43758.5453) % 1;
}

function mountFallbackCanvas(shell: DemoContext, label: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.dataset.demoFallbackCanvas = "true";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", label);
  Object.assign(canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%" });
  shell.canvas.hidden = true;
  shell.stage.append(canvas);
  return canvas;
}

async function assertShaderModule(module: GPUShaderModule, label: string): Promise<void> {
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((message) => message.type === "error");
  if (errors.length)
    throw new Error(`${label} failed: ${errors.map((message) => message.message).join("; ")}`);
}
