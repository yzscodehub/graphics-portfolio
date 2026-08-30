/* eslint-disable @typescript-eslint/no-explicit-any -- WebGPU DOM types are not available in every supported TypeScript lib. */
import {
  clearElement,
  createMetricReporter,
  drawStageBackdrop,
  makeButton,
  resizeCanvas,
} from "./core/canvas";
import type { DemoContext, DemoController } from "./core/types";

type GpuLike = {
  requestAdapter(): Promise<any>;
  getPreferredCanvasFormat(): string;
};

const PARTICLE_COUNTS = [25_000, 100_000, 250_000] as const;

export function createDemo(): DemoController {
  let context: DemoContext;
  let fallback: CanvasParticleFallback | undefined;
  let native: WebGpuParticleRenderer | undefined;
  let requestedCount: number = PARTICLE_COUNTS[0];

  const setup = async () => {
    native?.dispose();
    fallback?.dispose();
    native = undefined;
    fallback = undefined;
    const gpu = (navigator as Navigator & { gpu?: GpuLike }).gpu;
    if (gpu) {
      try {
        native = await WebGpuParticleRenderer.create(context, requestedCount);
        context.setStatus(
          `Native WebGPU compute pipeline active with ${requestedCount.toLocaleString()} particles.`,
          "success",
        );
        return;
      } catch (error) {
        context.setStatus(
          `WebGPU initialization failed; using a reduced Canvas preview. ${error instanceof Error ? error.message : ""}`,
          "warning",
        );
      }
    } else {
      context.setStatus(
        "WebGPU is unavailable; showing a reduced Canvas preview rather than claiming GPU results.",
        "warning",
      );
    }
    fallback = new CanvasParticleFallback(context, Math.min(1_800, requestedCount));
  };

  return {
    async init(next) {
      context = next;
      clearElement(context.controls);
      PARTICLE_COUNTS.forEach((count) => {
        const button = makeButton(`${count / 1000}K`, count === requestedCount);
        button.addEventListener(
          "click",
          async () => {
            requestedCount = count;
            context.controls
              .querySelectorAll<HTMLButtonElement>("button")
              .forEach((candidate) =>
                candidate.setAttribute("aria-pressed", String(candidate === button)),
              );
            await setup();
            native?.resize();
            fallback?.resize();
          },
          { signal: context.signal },
        );
        context.controls.append(button);
      });
      await setup();
    },
    resize() {
      native?.resize();
      fallback?.resize();
    },
    pause() {
      native?.pause();
      fallback?.pause();
    },
    resume() {
      native?.resume();
      fallback?.resume();
    },
    dispose() {
      native?.dispose();
      fallback?.dispose();
    },
  };
}

class CanvasParticleFallback {
  private readonly particles: Float32Array;
  private context2d: CanvasRenderingContext2D;
  private running = false;
  private raf = 0;
  private last = performance.now();
  private readonly report: ReturnType<typeof createMetricReporter>;

  constructor(
    private readonly shell: DemoContext,
    count: number,
  ) {
    this.particles = new Float32Array(count * 4);
    for (let index = 0; index < count; index += 1) {
      const start = index * 4;
      const angle = deterministic(index * 17.3) * Math.PI * 2;
      const radius = Math.sqrt(deterministic(index * 91.7));
      this.particles[start] = Math.cos(angle) * radius;
      this.particles[start + 1] = Math.sin(angle) * radius;
      this.particles[start + 2] = (deterministic(index + 10) - 0.5) * 0.002;
      this.particles[start + 3] = (deterministic(index + 20) - 0.5) * 0.002;
    }
    this.context2d = resizeCanvas(shell.canvas, shell.stage.clientWidth, shell.stage.clientHeight);
    this.report = createMetricReporter(shell);
  }

  resize(): void {
    this.context2d = resizeCanvas(
      this.shell.canvas,
      this.shell.stage.clientWidth,
      this.shell.stage.clientHeight,
    );
  }
  pause(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
  resume(): void {
    if (this.running) return;
    this.running = true;
    this.raf = requestAnimationFrame(this.render);
  }
  dispose(): void {
    this.pause();
  }

  private render = (now: number): void => {
    if (!this.running) return;
    const dt = Math.min(32, now - this.last);
    this.last = now;
    const { width, height } = this.shell.stage.getBoundingClientRect();
    drawStageBackdrop(this.context2d, width, height);
    const cx = width * 0.5;
    const cy = height * 0.5;
    this.context2d.fillStyle = "rgba(87,227,194,.72)";
    for (let index = 0; index < this.particles.length; index += 4) {
      const x = this.particles[index];
      const y = this.particles[index + 1];
      const d = Math.max(0.15, Math.hypot(x, y));
      this.particles[index + 2] += (-x / d) * 0.000012 * dt;
      this.particles[index + 3] += (-y / d) * 0.000012 * dt;
      this.particles[index + 2] *= 0.994;
      this.particles[index + 3] *= 0.994;
      this.particles[index] += this.particles[index + 2] * dt;
      this.particles[index + 1] += this.particles[index + 3] * dt;
      this.context2d.fillRect(
        cx + this.particles[index] * width * 0.33,
        cy + this.particles[index + 1] * height * 0.33,
        1.3,
        1.3,
      );
    }
    this.context2d.fillStyle = "#e8e6dc";
    this.context2d.font = "12px ui-monospace, monospace";
    this.context2d.fillText(
      `CANVAS PREVIEW · ${this.particles.length / 4} DRAWN PARTICLES`,
      16,
      24,
    );
    this.report({ backend: "Canvas fallback", status: "Reduced preview" });
    this.raf = requestAnimationFrame(this.render);
  };
}

class WebGpuParticleRenderer {
  private constructor(
    private readonly shell: DemoContext,
    private readonly device: any,
    private readonly gpuContext: any,
    private readonly format: string,
    private readonly particles: any,
    private readonly uniform: any,
    private readonly computePipeline: any,
    private readonly renderPipeline: any,
    private readonly computeBindGroup: any,
    private readonly renderBindGroup: any,
    private readonly count: number,
  ) {
    this.report = createMetricReporter(shell);
  }

  private raf = 0;
  private running = false;
  private readonly report: ReturnType<typeof createMetricReporter>;

  static async create(shell: DemoContext, count: number): Promise<WebGpuParticleRenderer> {
    const gpu = (navigator as Navigator & { gpu?: GpuLike }).gpu;
    const adapter = await gpu?.requestAdapter();
    if (!adapter) throw new Error("No WebGPU adapter was returned.");
    const device = await adapter.requestDevice();
    void device.lost?.then(() =>
      shell.setStatus(
        "WebGPU device was lost. Reload the demo to recreate its resources.",
        "warning",
      ),
    );
    const gpuContext = shell.canvas.getContext("webgpu") as any;
    if (!gpuContext) throw new Error("The canvas could not create a WebGPU context.");
    const format = gpu!.getPreferredCanvasFormat();
    gpuContext.configure({ device, format, alphaMode: "opaque" });
    const usage = (globalThis as any).GPUBufferUsage;
    const particleData = new Float32Array(count * 4);
    for (let index = 0; index < count; index += 1) {
      const offset = index * 4;
      const angle = deterministic(index * 27.1) * Math.PI * 2;
      const radius = Math.sqrt(deterministic(index * 101.3));
      particleData[offset] = Math.cos(angle) * radius;
      particleData[offset + 1] = Math.sin(angle) * radius;
      particleData[offset + 2] = (deterministic(index + 4) - 0.5) * 0.003;
      particleData[offset + 3] = (deterministic(index + 8) - 0.5) * 0.003;
    }
    const particles = device.createBuffer({
      size: particleData.byteLength,
      usage: usage.STORAGE | usage.COPY_DST,
    });
    device.queue.writeBuffer(particles, 0, particleData);
    const uniform = device.createBuffer({ size: 16, usage: usage.UNIFORM | usage.COPY_DST });
    const computeModule = device.createShaderModule({ code: PARTICLE_COMPUTE_WGSL });
    const renderModule = device.createShaderModule({ code: PARTICLE_RENDER_WGSL });
    const computePipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module: computeModule, entryPoint: "main" },
    });
    const renderPipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module: renderModule, entryPoint: "vs" },
      fragment: { module: renderModule, entryPoint: "fs", targets: [{ format }] },
      primitive: { topology: "point-list" },
    });
    const computeBindGroup = device.createBindGroup({
      layout: computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: particles } },
        { binding: 1, resource: { buffer: uniform } },
      ],
    });
    const renderBindGroup = device.createBindGroup({
      layout: renderPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: particles } }],
    });
    return new WebGpuParticleRenderer(
      shell,
      device,
      gpuContext,
      format,
      particles,
      uniform,
      computePipeline,
      renderPipeline,
      computeBindGroup,
      renderBindGroup,
      count,
    );
  }

  resize(): void {
    const bounds = this.shell.stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.shell.canvas.width = Math.max(1, Math.floor(bounds.width * dpr));
    this.shell.canvas.height = Math.max(1, Math.floor(bounds.height * dpr));
    this.gpuContext.configure({ device: this.device, format: this.format, alphaMode: "opaque" });
  }
  pause(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
  resume(): void {
    if (this.running) return;
    this.running = true;
    this.raf = requestAnimationFrame(this.render);
  }
  dispose(): void {
    this.pause();
    this.particles.destroy();
    this.uniform.destroy();
  }

  private render = (now: number): void => {
    if (!this.running) return;
    this.device.queue.writeBuffer(this.uniform, 0, new Float32Array([now * 0.001, 0, 0, 0]));
    const encoder = this.device.createCommandEncoder();
    const compute = encoder.beginComputePass();
    compute.setPipeline(this.computePipeline);
    compute.setBindGroup(0, this.computeBindGroup);
    compute.dispatchWorkgroups(Math.ceil(this.count / 64));
    compute.end();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.gpuContext.getCurrentTexture().createView(),
          clearValue: { r: 0.02, g: 0.06, b: 0.06, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(this.renderPipeline);
    pass.setBindGroup(0, this.renderBindGroup);
    pass.draw(this.count);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    this.report({ backend: "WebGPU compute", status: `${this.count.toLocaleString()} particles` });
    this.raf = requestAnimationFrame(this.render);
  };
}

const PARTICLE_COMPUTE_WGSL = `
struct Particle { pos: vec2f, velocity: vec2f }
struct Uniforms { time: f32, _pad0: vec3f }
@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform> uniforms: Uniforms;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let index = id.x;
  if (index >= arrayLength(&particles)) { return; }
  var particle = particles[index];
  let distanceToOrigin = max(length(particle.pos), 0.12);
  let force = -normalize(particle.pos) * 0.000016;
  let swirl = vec2f(-particle.pos.y, particle.pos.x) * 0.000008;
  particle.velocity = (particle.velocity + (force + swirl) * (0.7 + 0.3 * sin(uniforms.time))) * 0.996;
  particle.pos = particle.pos + particle.velocity;
  if (distanceToOrigin > 1.2) { particle.velocity = particle.velocity - normalize(particle.pos) * 0.004; }
  particles[index] = particle;
}`;

const PARTICLE_RENDER_WGSL = `
struct Particle { pos: vec2f, velocity: vec2f }
@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@vertex fn vs(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  return vec4f(particles[index].pos, 0.0, 1.0);
}
@fragment fn fs() -> @location(0) vec4f { return vec4f(0.34, 0.89, 0.76, 1.0); }`;

function deterministic(seed: number): number {
  return Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1;
}
