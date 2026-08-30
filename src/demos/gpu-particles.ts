import {
  clearElement,
  createMetricReporter,
  drawStageBackdrop,
  makeButton,
  makeRange,
  resizeCanvas,
} from "./core/canvas";
import type { DemoContext, DemoController } from "./core/types";

export const PARTICLE_COUNTS = [25_000, 100_000, 250_000] as const;
const PARTICLE_STRIDE_FLOATS = 8;

export interface ParticleSeed {
  position: [number, number];
  velocity: [number, number];
  age: number;
  lifetime: number;
  seed: number;
}

export function createParticleSeed(index: number): ParticleSeed {
  const angle = deterministic(index * 27.1) * Math.PI * 2;
  const radius = Math.sqrt(deterministic(index * 101.3)) * 0.92;
  const lifetime = 2.5 + deterministic(index + 53) * 5;
  return {
    position: [Math.cos(angle) * radius, Math.sin(angle) * radius],
    velocity: [(deterministic(index + 4) - 0.5) * 0.34, (deterministic(index + 8) - 0.5) * 0.34],
    age: deterministic(index + 31) * lifetime,
    lifetime,
    seed: deterministic(index + 79),
  };
}

export function createParticleData(count: number): Float32Array {
  const data = new Float32Array(count * PARTICLE_STRIDE_FLOATS);
  for (let index = 0; index < count; index += 1) {
    const particle = createParticleSeed(index);
    const offset = index * PARTICLE_STRIDE_FLOATS;
    data.set(
      [
        particle.position[0],
        particle.position[1],
        particle.velocity[0],
        particle.velocity[1],
        particle.age,
        particle.lifetime,
        particle.seed,
        0,
      ],
      offset,
    );
  }
  return data;
}

/** Returns a finite direction even when the attractor is exactly at the particle. */
export function normalizedAttractorDelta(dx: number, dy: number): [number, number] {
  const length = Math.hypot(dx, dy);
  if (!(length > 1e-6)) return [0, 0];
  return [dx / length, dy / length];
}

interface ParticleRenderer {
  resize(): void;
  setAttractor(x: number, y: number, strength: number): void;
  setUserPaused(paused: boolean): void;
  reset(): void;
  pause(): void;
  resume(): void;
  dispose(): void;
}

export function createDemo(): DemoController {
  let context: DemoContext;
  let active: ParticleRenderer | undefined;
  let requestedCount: number = PARTICLE_COUNTS[0];
  let attractor: [number, number] = [0, 0];
  let strength = 1;
  let userPaused = false;
  let running = false;
  let generation = 0;

  const useFallback = (reason: string, expectedGeneration: number) => {
    if (generation !== expectedGeneration) return;
    active?.dispose();
    const fallback = new CanvasParticleFallback(context, Math.min(1_800, requestedCount));
    fallback.setAttractor(attractor[0], attractor[1], strength);
    fallback.setUserPaused(userPaused);
    fallback.resize();
    active = fallback;
    if (running) fallback.resume();
    context.setStatus(`${reason} Showing reduced deterministic Canvas particles.`, "warning");
  };

  const setup = async () => {
    const currentGeneration = ++generation;
    active?.dispose();
    active = undefined;
    try {
      const renderer = await WebGpuParticleRenderer.create(context, requestedCount, (message) =>
        useFallback(message, currentGeneration),
      );
      if (generation !== currentGeneration) {
        renderer.dispose();
        return;
      }
      renderer.setAttractor(attractor[0], attractor[1], strength);
      renderer.setUserPaused(userPaused);
      renderer.resize();
      active = renderer;
      if (running) renderer.resume();
      context.setStatus(
        `WebGPU Ping-Pong compute active with ${requestedCount.toLocaleString()} particles. Move the pointer to steer the attractor.`,
        "success",
      );
    } catch (error) {
      useFallback(
        error instanceof Error ? error.message : "WebGPU particles could not initialize.",
        currentGeneration,
      );
    }
  };

  return {
    async init(next) {
      context = next;
      clearElement(context.controls);
      const countButtons = PARTICLE_COUNTS.map((count) =>
        makeButton(`${count / 1000}K`, count === requestedCount),
      );
      countButtons.forEach((button, index) =>
        button.addEventListener(
          "click",
          async () => {
            requestedCount = PARTICLE_COUNTS[index];
            countButtons.forEach((entry) =>
              entry.setAttribute("aria-pressed", String(entry === button)),
            );
            countButtons.forEach((entry) => (entry.disabled = true));
            await setup();
            countButtons.forEach((entry) => (entry.disabled = false));
          },
          { signal: context.signal },
        ),
      );
      const strengthRange = makeRange("Attractor", strength, 0, 2.5, 0.05);
      strengthRange.addEventListener(
        "input",
        () => {
          strength = Number(strengthRange.value);
          active?.setAttractor(attractor[0], attractor[1], strength);
        },
        { signal: context.signal },
      );
      const pauseButton = makeButton("PAUSE", false);
      pauseButton.addEventListener(
        "click",
        () => {
          userPaused = !userPaused;
          pauseButton.textContent = userPaused ? "RESUME" : "PAUSE";
          pauseButton.setAttribute("aria-pressed", String(userPaused));
          active?.setUserPaused(userPaused);
        },
        { signal: context.signal },
      );
      const resetButton = makeButton("RESET");
      resetButton.addEventListener("click", () => active?.reset(), { signal: context.signal });
      context.stage.addEventListener(
        "pointermove",
        (event) => {
          const bounds = context.stage.getBoundingClientRect();
          attractor = [
            ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * 2 - 1,
            -(((event.clientY - bounds.top) / Math.max(bounds.height, 1)) * 2 - 1),
          ];
          active?.setAttractor(attractor[0], attractor[1], strength);
        },
        { signal: context.signal },
      );
      context.controls.append(
        ...countButtons,
        strengthRange.parentElement!,
        pauseButton,
        resetButton,
      );
      await setup();
    },
    resize() {
      active?.resize();
    },
    pause() {
      running = false;
      active?.pause();
    },
    resume() {
      running = true;
      active?.resume();
    },
    dispose() {
      generation += 1;
      active?.dispose();
      active = undefined;
    },
  };
}

class CanvasParticleFallback implements ParticleRenderer {
  private readonly particles: Float32Array;
  private readonly canvas: HTMLCanvasElement;
  private context2d: CanvasRenderingContext2D;
  private running = false;
  private userPaused = false;
  private raf = 0;
  private last = performance.now();
  private attractor: [number, number, number] = [0, 0, 1];
  private readonly report: ReturnType<typeof createMetricReporter>;

  constructor(
    private readonly shell: DemoContext,
    count: number,
  ) {
    this.particles = createParticleData(count);
    this.canvas = mountFallbackCanvas(shell, "Canvas particle fallback visual output");
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

  setAttractor(x: number, y: number, strength: number): void {
    this.attractor = [x, y, strength];
  }

  setUserPaused(paused: boolean): void {
    if (this.userPaused === paused) return;
    this.userPaused = paused;
    if (paused) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      return;
    }
    this.schedule();
  }

  reset(): void {
    this.particles.set(createParticleData(this.particles.length / PARTICLE_STRIDE_FLOATS));
  }

  pause(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  resume(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.schedule();
  }

  dispose(): void {
    this.pause();
    this.canvas.remove();
    this.shell.canvas.hidden = false;
  }

  private render = (now: number): void => {
    if (!this.running) return;
    this.raf = 0;
    if (this.userPaused) return;
    const dt = Math.min(0.033, (now - this.last) / 1000);
    this.last = now;
    const { width, height } = this.shell.stage.getBoundingClientRect();
    drawStageBackdrop(this.context2d, width, height);
    const cx = width * 0.5;
    const cy = height * 0.5;
    this.context2d.fillStyle = "rgba(87,227,194,.72)";
    for (let index = 0; index < this.particles.length; index += PARTICLE_STRIDE_FLOATS) {
      let x = this.particles[index];
      let y = this.particles[index + 1];
      let vx = this.particles[index + 2];
      let vy = this.particles[index + 3];
      let age = this.particles[index + 4] + dt;
      const lifetime = this.particles[index + 5];
      if (age >= lifetime) {
        const seed = createParticleSeed(index / PARTICLE_STRIDE_FLOATS + Math.floor(now));
        [x, y] = seed.position;
        [vx, vy] = seed.velocity;
        age = 0;
      }
      const dx = this.attractor[0] - x;
      const dy = this.attractor[1] - y;
      const [attractorX, attractorY] = normalizedAttractorDelta(dx, dy);
      vx = (vx + attractorX * this.attractor[2] * dt * 0.52 - y * dt * 0.12) * 0.995;
      vy = (vy + attractorY * this.attractor[2] * dt * 0.52 + x * dt * 0.12) * 0.995;
      x += vx * dt;
      y += vy * dt;
      this.particles.set([x, y, vx, vy, age], index);
      this.context2d.globalAlpha = 0.25 + 0.75 * (1 - age / lifetime);
      this.context2d.fillRect(cx + x * width * 0.42, cy - y * height * 0.42, 1.3, 1.3);
    }
    this.context2d.globalAlpha = 1;
    this.context2d.fillStyle = "#e8e6dc";
    this.context2d.font = "12px ui-monospace, monospace";
    this.context2d.fillText(
      `CANVAS FALLBACK · ${this.particles.length / PARTICLE_STRIDE_FLOATS} PARTICLES`,
      16,
      24,
    );
    this.report({ backend: "Canvas fallback", status: "Reduced lifecycle preview" });
    this.schedule();
  };

  private schedule(): void {
    if (!this.running || this.userPaused || this.raf) return;
    this.raf = requestAnimationFrame(this.render);
  }
}

class WebGpuParticleRenderer implements ParticleRenderer {
  private constructor(
    private readonly shell: DemoContext,
    private readonly adapter: GPUAdapter,
    private readonly device: GPUDevice,
    private readonly gpuContext: GPUCanvasContext,
    private readonly format: GPUTextureFormat,
    private readonly particleBuffers: [GPUBuffer, GPUBuffer],
    private readonly uniformBuffer: GPUBuffer,
    private readonly computePipeline: GPUComputePipeline,
    private readonly renderPipeline: GPURenderPipeline,
    private readonly computeBindGroups: [GPUBindGroup, GPUBindGroup],
    private readonly renderBindGroups: [GPUBindGroup, GPUBindGroup],
    private readonly count: number,
    private readonly queryState: TimestampQueryState | undefined,
  ) {
    this.report = createMetricReporter(shell);
  }

  private raf = 0;
  private running = false;
  private userPaused = false;
  private readIndex = 0;
  private frameIndex = 0;
  private last = performance.now();
  private attractor: [number, number, number] = [0, 0, 1];
  private readonly report: ReturnType<typeof createMetricReporter>;
  private disposed = false;

  static async create(
    shell: DemoContext,
    count: number,
    onDeviceLost: (message: string) => void,
  ): Promise<WebGpuParticleRenderer> {
    if (!navigator.gpu) throw new Error("WebGPU is unavailable.");
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) throw new Error("No WebGPU adapter was returned.");
    const timestampSupported = adapter.features.has("timestamp-query");
    const device = await adapter.requestDevice({
      requiredFeatures: timestampSupported ? ["timestamp-query"] : [],
    });
    const allocations: GPUBuffer[] = [];
    let queryState: TimestampQueryState | undefined;
    let renderer: WebGpuParticleRenderer | undefined;
    try {
      const gpuContext = shell.canvas.getContext("webgpu");
      if (!gpuContext) throw new Error("The canvas could not create a WebGPU context.");
      const format = navigator.gpu.getPreferredCanvasFormat();
      const particleData = createParticleData(count);
      const [particleBuffers, uniformBuffer] = await withValidationScope(
        device,
        "Particle buffer setup",
        () => {
          const buffers = [0, 1].map((index) => {
            const buffer = device.createBuffer({
              label: `Particles/State${index}`,
              size: particleData.byteLength,
              usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
            });
            allocations.push(buffer);
            device.queue.writeBuffer(buffer, 0, particleData);
            return buffer;
          }) as [GPUBuffer, GPUBuffer];
          const uniforms = device.createBuffer({
            label: "Particles/Uniforms",
            size: 32,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          });
          allocations.push(uniforms);
          return [buffers, uniforms] as const;
        },
      );
      const computeModule = device.createShaderModule({
        label: "Particles/ComputeWGSL",
        code: PARTICLE_COMPUTE_WGSL,
      });
      const renderModule = device.createShaderModule({
        label: "Particles/RenderWGSL",
        code: PARTICLE_RENDER_WGSL,
      });
      await assertShaderModule(computeModule, "Particle compute shader");
      await assertShaderModule(renderModule, "Particle render shader");
      const computePipeline = await withValidationScope(device, "Particle compute pipeline", () =>
        device.createComputePipelineAsync({
          label: "Particles/ComputePipeline",
          layout: "auto",
          compute: { module: computeModule, entryPoint: "main" },
        }),
      );
      const renderPipeline = await withValidationScope(device, "Particle render pipeline", () =>
        device.createRenderPipelineAsync({
          label: "Particles/RenderPipeline",
          layout: "auto",
          vertex: { module: renderModule, entryPoint: "vs" },
          fragment: { module: renderModule, entryPoint: "fs", targets: [{ format }] },
          primitive: { topology: "point-list" },
        }),
      );
      const [computeBindGroups, renderBindGroups] = await withValidationScope(
        device,
        "Particle bind group setup",
        () => {
          const compute = [0, 1].map((readIndex) =>
            device.createBindGroup({
              label: `Particles/ComputeBind${readIndex}`,
              layout: computePipeline.getBindGroupLayout(0),
              entries: [
                { binding: 0, resource: { buffer: particleBuffers[readIndex] } },
                { binding: 1, resource: { buffer: particleBuffers[1 - readIndex] } },
                { binding: 2, resource: { buffer: uniformBuffer } },
              ],
            }),
          ) as [GPUBindGroup, GPUBindGroup];
          const render = [0, 1].map((index) =>
            device.createBindGroup({
              label: `Particles/RenderBind${index}`,
              layout: renderPipeline.getBindGroupLayout(0),
              entries: [{ binding: 0, resource: { buffer: particleBuffers[index] } }],
            }),
          ) as [GPUBindGroup, GPUBindGroup];
          return [compute, render] as const;
        },
      );
      queryState = timestampSupported ? TimestampQueryState.create(device) : undefined;
      renderer = new WebGpuParticleRenderer(
        shell,
        adapter,
        device,
        gpuContext,
        format,
        particleBuffers,
        uniformBuffer,
        computePipeline,
        renderPipeline,
        computeBindGroups,
        renderBindGroups,
        count,
        queryState,
      );
      await withValidationScope(device, "Particle initial canvas configuration", () =>
        renderer!.resize(),
      );
      renderer.watchDeviceLoss(onDeviceLost);
      shell.setMetrics({
        backend: renderer.backendLabel,
        status: timestampSupported ? "GPU timestamps ready" : "GPU timing N/A",
        metricSource: timestampSupported ? "gpu-timestamp-query" : "unavailable",
      });
      return renderer;
    } catch (error) {
      renderer?.dispose();
      if (!renderer) {
        queryState?.dispose();
        allocations.forEach((buffer) => buffer.destroy());
        device.destroy();
      }
      throw error;
    }
  }

  get backendLabel(): string {
    return `Raw WebGPU / ${this.adapter.info?.device || this.adapter.info?.architecture || "adapter"}`;
  }

  resize(): void {
    const bounds = this.shell.stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.shell.canvas.width = Math.max(1, Math.floor(bounds.width * dpr));
    this.shell.canvas.height = Math.max(1, Math.floor(bounds.height * dpr));
    this.gpuContext.configure({ device: this.device, format: this.format, alphaMode: "opaque" });
  }

  setAttractor(x: number, y: number, strength: number): void {
    this.attractor = [x, y, strength];
  }

  setUserPaused(paused: boolean): void {
    if (this.userPaused === paused || this.disposed) return;
    this.userPaused = paused;
    if (paused) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.shell.setMetrics({
        backend: this.backendLabel,
        status: `Paused at frame ${this.frameIndex}; no GPU work is submitted.`,
        metricSource: "animation-frame",
      });
      return;
    }
    this.schedule();
  }

  reset(): void {
    const data = createParticleData(this.count);
    this.particleBuffers.forEach((buffer) => this.device.queue.writeBuffer(buffer, 0, data));
    this.readIndex = 0;
    this.frameIndex = 0;
  }

  pause(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  resume(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.last = performance.now();
    this.schedule();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pause();
    this.queryState?.dispose();
    this.particleBuffers.forEach((buffer) => buffer.destroy());
    this.uniformBuffer.destroy();
    this.device.destroy();
  }

  private render = (now: number): void => {
    if (!this.running || this.disposed) return;
    this.raf = 0;
    if (this.userPaused) return;
    const dt = Math.min(0.033, (now - this.last) / 1000);
    this.last = now;
    this.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      new Float32Array([
        dt,
        now * 0.001,
        this.attractor[0],
        this.attractor[1],
        this.attractor[2],
        this.count,
        this.frameIndex,
        0,
      ]),
    );
    const writeIndex = 1 - this.readIndex;
    const encoder = this.device.createCommandEncoder({
      label: `Particles/Frame${this.frameIndex}`,
    });
    const compute = encoder.beginComputePass(
      this.queryState?.computePassDescriptor ?? { label: "Particles/ComputePass" },
    );
    compute.setPipeline(this.computePipeline);
    compute.setBindGroup(0, this.computeBindGroups[this.readIndex]);
    compute.dispatchWorkgroups(Math.ceil(this.count / 64));
    compute.end();
    const renderPass = encoder.beginRenderPass({
      label: "Particles/RenderPass",
      colorAttachments: [
        {
          view: this.gpuContext.getCurrentTexture().createView(),
          clearValue: { r: 0.02, g: 0.055, b: 0.06, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
      timestampWrites: this.queryState?.renderTimestampWrites,
    });
    renderPass.setPipeline(this.renderPipeline);
    renderPass.setBindGroup(0, this.renderBindGroups[writeIndex]);
    renderPass.draw(this.count);
    renderPass.end();
    this.queryState?.encodeResolve(encoder, this.frameIndex, (metrics) => {
      this.shell.setMetrics({
        backend: this.backendLabel,
        status: `${this.count.toLocaleString()} particles · compute ${metrics.computeMs.toFixed(2)} ms · render ${metrics.renderMs.toFixed(2)} ms`,
        frameTimeMs: metrics.computeMs + metrics.renderMs,
        metricSource: "gpu-timestamp-query",
      });
    });
    this.device.queue.submit([encoder.finish()]);
    this.queryState?.afterSubmit();
    this.readIndex = writeIndex;
    this.frameIndex += 1;
    if (!this.queryState)
      this.report({
        backend: this.backendLabel,
        status: `${this.count.toLocaleString()} particles · GPU timing N/A`,
        metricSource: "animation-frame",
      });
    this.schedule();
  };

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
}

interface TimestampMetrics {
  computeMs: number;
  renderMs: number;
}

class TimestampQueryState {
  private constructor(
    private readonly device: GPUDevice,
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
      querySet = device.createQuerySet({ type: "timestamp", count: 4 });
      resolveBuffer = device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
      });
      for (let index = 0; index < 3; index += 1) {
        readbacks.push(
          device.createBuffer({
            size: 32,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
          }),
        );
      }
      return new TimestampQueryState(device, querySet, resolveBuffer, readbacks);
    } catch (error) {
      querySet?.destroy();
      resolveBuffer?.destroy();
      readbacks.forEach((buffer) => buffer.destroy());
      throw error;
    }
  }

  get computePassDescriptor(): GPUComputePassDescriptor {
    return {
      label: "Particles/ComputePass",
      timestampWrites: {
        querySet: this.querySet,
        beginningOfPassWriteIndex: 0,
        endOfPassWriteIndex: 1,
      },
    };
  }

  get renderTimestampWrites(): GPURenderPassTimestampWrites {
    return {
      querySet: this.querySet,
      beginningOfPassWriteIndex: 2,
      endOfPassWriteIndex: 3,
    };
  }

  encodeResolve(
    encoder: GPUCommandEncoder,
    frameIndex: number,
    report: (metrics: TimestampMetrics) => void,
  ): void {
    encoder.resolveQuerySet(this.querySet, 0, 4, this.resolveBuffer, 0);
    const slot = frameIndex % this.readbacks.length;
    if (this.busy[slot] || frameIndex % 20 !== 0) return;
    this.busy[slot] = true;
    const readback = this.readbacks[slot];
    encoder.copyBufferToBuffer(this.resolveBuffer, 0, readback, 0, 32);
    this.pending = { slot, report };
  }

  afterSubmit(): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = undefined;
    const { slot, report } = pending;
    const readback = this.readbacks[slot];
    void readback
      .mapAsync(GPUMapMode.READ)
      .then(() => {
        const values = new BigUint64Array(readback.getMappedRange().slice(0));
        readback.unmap();
        report({
          computeMs: Number(values[1] - values[0]) / 1_000_000,
          renderMs: Number(values[3] - values[2]) / 1_000_000,
        });
      })
      .catch(() => undefined)
      .finally(() => {
        this.busy[slot] = false;
      });
  }

  dispose(): void {
    this.querySet.destroy();
    this.resolveBuffer.destroy();
    this.readbacks.forEach((buffer) => buffer.destroy());
    void this.device.queue.onSubmittedWorkDone();
  }
}

const PARTICLE_COMPUTE_WGSL = /* wgsl */ `
struct Particle {
  position: vec2f,
  velocity: vec2f,
  age: f32,
  lifetime: f32,
  seed: f32,
  _pad: f32,
}
struct Uniforms {
  deltaTime: f32,
  time: f32,
  attractor: vec2f,
  strength: f32,
  count: f32,
  frame: f32,
  _pad: f32,
}
@group(0) @binding(0) var<storage, read> inputParticles: array<Particle>;
@group(0) @binding(1) var<storage, read_write> outputParticles: array<Particle>;
@group(0) @binding(2) var<uniform> uniforms: Uniforms;

fn hash(value: f32) -> f32 {
  return fract(sin(value * 12.9898 + uniforms.frame * 0.071) * 43758.5453);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let index = id.x;
  if (index >= u32(uniforms.count)) { return; }
  var particle = inputParticles[index];
  particle.age += uniforms.deltaTime;
  if (particle.age >= particle.lifetime || length(particle.position) > 1.8) {
    let angle = hash(particle.seed + f32(index)) * 6.2831853;
    let radius = sqrt(hash(particle.seed * 31.0 + f32(index))) * 0.92;
    particle.position = vec2f(cos(angle), sin(angle)) * radius;
    particle.velocity = vec2f(-sin(angle), cos(angle)) * (0.05 + hash(particle.seed * 7.0) * 0.2);
    particle.age = 0.0;
    particle.lifetime = 2.5 + hash(particle.seed * 13.0) * 5.0;
  }
  let delta = uniforms.attractor - particle.position;
  let distanceToAttractor = max(length(delta), 0.12);
  let attraction = (delta / distanceToAttractor) * uniforms.strength * 0.52;
  let swirl = vec2f(-particle.position.y, particle.position.x) * 0.12;
  particle.velocity = (particle.velocity + (attraction + swirl) * uniforms.deltaTime) * 0.995;
  particle.position += particle.velocity * uniforms.deltaTime;
  outputParticles[index] = particle;
}
`;

const PARTICLE_RENDER_WGSL = /* wgsl */ `
struct Particle {
  position: vec2f,
  velocity: vec2f,
  age: f32,
  lifetime: f32,
  seed: f32,
  _pad: f32,
}
@group(0) @binding(0) var<storage, read> particles: array<Particle>;
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) life: f32,
}
@vertex fn vs(@builtin(vertex_index) index: u32) -> VertexOutput {
  let particle = particles[index];
  var output: VertexOutput;
  output.position = vec4f(particle.position, 0.0, 1.0);
  output.life = clamp(1.0 - particle.age / max(particle.lifetime, 0.001), 0.0, 1.0);
  return output;
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  return vec4f(mix(vec3f(0.94, 0.49, 0.22), vec3f(0.34, 0.89, 0.76), input.life), 1.0);
}
`;

function deterministic(seed: number): number {
  return Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1;
}

function mountFallbackCanvas(shell: DemoContext, label: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.dataset.demoFallbackCanvas = "true";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", label);
  Object.assign(canvas.style, {
    position: "absolute",
    inset: "0",
    width: "100%",
    height: "100%",
  });
  shell.canvas.hidden = true;
  shell.stage.append(canvas);
  return canvas;
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
