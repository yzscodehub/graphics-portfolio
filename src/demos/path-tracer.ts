/* eslint-disable @typescript-eslint/no-explicit-any -- WebGPU DOM types are not available in every supported TypeScript lib. */
import {
  clearElement,
  createMetricReporter,
  drawStageBackdrop,
  makeButton,
  resizeCanvas,
} from "./core/canvas";
import type { DemoContext, DemoController } from "./core/types";

type GpuLike = { requestAdapter(): Promise<any>; getPreferredCanvasFormat(): string };

export function createDemo(): DemoController {
  let context: DemoContext;
  let native: WebGpuPathTracer | undefined;
  let fallback: CanvasPathPreview | undefined;
  let bounces = 4;

  const setup = async () => {
    native?.dispose();
    fallback?.dispose();
    native = undefined;
    fallback = undefined;
    const gpu = (navigator as Navigator & { gpu?: GpuLike }).gpu;
    if (gpu) {
      try {
        native = await WebGpuPathTracer.create(context, bounces);
        context.setStatus(
          `Native WebGPU progressive estimator active; maximum ${bounces} path bounces.`,
          "success",
        );
        return;
      } catch (error) {
        context.setStatus(
          `WebGPU path tracer could not start; using a labeled CPU preview. ${error instanceof Error ? error.message : ""}`,
          "warning",
        );
      }
    } else {
      context.setStatus(
        "WebGPU is unavailable; this is a simplified CPU preview, not a GPU timing claim.",
        "warning",
      );
    }
    fallback = new CanvasPathPreview(context, bounces);
  };
  return {
    async init(next) {
      context = next;
      clearElement(context.controls);
      [2, 3, 4].forEach((count) => {
        const button = makeButton(`${count} BOUNCES`, count === bounces);
        button.addEventListener(
          "click",
          async () => {
            bounces = count;
            context.controls
              .querySelectorAll<HTMLButtonElement>("button")
              .forEach((entry) => entry.setAttribute("aria-pressed", String(entry === button)));
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

class CanvasPathPreview {
  private ctx: CanvasRenderingContext2D;
  private running = false;
  private raf = 0;
  private samples = 0;
  private readonly report: ReturnType<typeof createMetricReporter>;
  constructor(
    private readonly shell: DemoContext,
    private readonly bounces: number,
  ) {
    this.ctx = resizeCanvas(shell.canvas, shell.stage.clientWidth, shell.stage.clientHeight);
    this.report = createMetricReporter(shell);
  }
  resize(): void {
    this.ctx = resizeCanvas(
      this.shell.canvas,
      this.shell.stage.clientWidth,
      this.shell.stage.clientHeight,
    );
    this.samples = 0;
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
  private render = (): void => {
    if (!this.running) return;
    const { width, height } = this.shell.stage.getBoundingClientRect();
    drawStageBackdrop(this.ctx, width, height);
    const room = { x: width * 0.18, y: height * 0.12, w: width * 0.64, h: height * 0.72 };
    this.ctx.fillStyle = "#b44f3f";
    this.ctx.fillRect(room.x, room.y, room.w * 0.08, room.h);
    this.ctx.fillStyle = "#3a7782";
    this.ctx.fillRect(room.x + room.w * 0.92, room.y, room.w * 0.08, room.h);
    this.ctx.fillStyle = "#c9c3af";
    this.ctx.fillRect(room.x + room.w * 0.08, room.y, room.w * 0.84, room.h);
    const jitter = deterministic(this.samples * 3.7) * 2 - 1;
    const light = this.ctx.createRadialGradient(
      width * 0.52,
      height * 0.19,
      1,
      width * 0.52 + jitter,
      height * 0.19,
      width * 0.28,
    );
    light.addColorStop(0, "rgba(255,244,201,.95)");
    light.addColorStop(1, "rgba(255,244,201,0)");
    this.ctx.fillStyle = light;
    this.ctx.fillRect(room.x, room.y, room.w, room.h);
    drawSphere(
      this.ctx,
      width * 0.42,
      height * 0.61,
      Math.min(width, height) * 0.115,
      "#54b8a3",
      0.42,
    );
    drawSphere(
      this.ctx,
      width * 0.63,
      height * 0.65,
      Math.min(width, height) * 0.09,
      "#d2a55a",
      0.75,
    );
    this.ctx.fillStyle = "#071011";
    this.ctx.font = "12px ui-monospace, monospace";
    this.ctx.fillText("CPU PATH-LIKE PREVIEW / NO GPU TIMINGS", 16, 24);
    this.ctx.fillStyle = "rgba(7,16,17,.74)";
    this.ctx.fillText(
      `${this.bounces} MAX BOUNCES · VISUAL SAMPLE ${this.samples + 1}`,
      16,
      height - 16,
    );
    this.samples += 1;
    this.report({
      backend: "Canvas CPU preview",
      status: `${this.bounces} bounces`,
      samples: this.samples,
    });
    this.raf = requestAnimationFrame(this.render);
  };
}

class WebGpuPathTracer {
  private constructor(
    private readonly shell: DemoContext,
    private readonly device: any,
    private readonly gpuContext: any,
    private readonly format: string,
    private readonly pipeline: any,
    private readonly sampler: any,
    private readonly uniform: any,
    private readonly bounces: number,
  ) {
    this.report = createMetricReporter(shell);
  }
  private textures: any[] = [];
  private readIndex = 0;
  private samples = 0;
  private running = false;
  private raf = 0;
  private readonly report: ReturnType<typeof createMetricReporter>;

  static async create(shell: DemoContext, bounces: number): Promise<WebGpuPathTracer> {
    const gpu = (navigator as Navigator & { gpu?: GpuLike }).gpu;
    const adapter = await gpu?.requestAdapter();
    if (!adapter) throw new Error("No WebGPU adapter was returned.");
    const device = await adapter.requestDevice();
    void device.lost?.then(() =>
      shell.setStatus(
        "WebGPU device was lost. Reload the demo to recreate its accumulation buffers.",
        "warning",
      ),
    );
    const gpuContext = shell.canvas.getContext("webgpu") as any;
    if (!gpuContext) throw new Error("The canvas does not expose WebGPU.");
    const format = gpu!.getPreferredCanvasFormat();
    gpuContext.configure({ device, format, alphaMode: "opaque" });
    const module = device.createShaderModule({ code: PATH_TRACER_WGSL });
    const pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs", targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    });
    const usage = (globalThis as any).GPUBufferUsage;
    const uniform = device.createBuffer({ size: 16, usage: usage.UNIFORM | usage.COPY_DST });
    return new WebGpuPathTracer(
      shell,
      device,
      gpuContext,
      format,
      pipeline,
      device.createSampler({ magFilter: "nearest", minFilter: "nearest" }),
      uniform,
      bounces,
    );
  }
  resize(): void {
    const bounds = this.shell.stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.shell.canvas.width = Math.max(1, Math.floor(bounds.width * dpr));
    this.shell.canvas.height = Math.max(1, Math.floor(bounds.height * dpr));
    this.gpuContext.configure({ device: this.device, format: this.format, alphaMode: "opaque" });
    this.textures.forEach((texture) => texture.destroy());
    this.textures = [];
    const usage = (globalThis as any).GPUTextureUsage;
    for (let index = 0; index < 2; index += 1)
      this.textures.push(
        this.device.createTexture({
          size: [this.shell.canvas.width, this.shell.canvas.height],
          format: this.format,
          usage: usage.RENDER_ATTACHMENT | usage.TEXTURE_BINDING,
        }),
      );
    this.readIndex = 0;
    this.samples = 0;
    for (const texture of this.textures) {
      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: texture.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });
      pass.end();
      this.device.queue.submit([encoder.finish()]);
    }
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
    this.textures.forEach((texture) => texture.destroy());
    this.uniform.destroy();
  }
  private render = (): void => {
    if (!this.running) return;
    if (!this.textures.length) this.resize();
    const writeIndex = 1 - this.readIndex;
    this.device.queue.writeBuffer(
      this.uniform,
      0,
      new Float32Array([
        this.shell.canvas.width,
        this.shell.canvas.height,
        this.samples,
        this.bounces,
      ]),
    );
    const group = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.textures[this.readIndex].createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.uniform } },
      ],
    });
    const encoder = this.device.createCommandEncoder();
    const accumulate = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.textures[writeIndex].createView(),
          loadOp: "clear",
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          storeOp: "store",
        },
      ],
    });
    accumulate.setPipeline(this.pipeline);
    accumulate.setBindGroup(0, group);
    accumulate.draw(3);
    accumulate.end();
    const copy = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.gpuContext.getCurrentTexture().createView(),
          loadOp: "clear",
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          storeOp: "store",
        },
      ],
    });
    copy.setPipeline(this.pipeline);
    copy.setBindGroup(
      0,
      this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.textures[writeIndex].createView() },
          { binding: 1, resource: this.sampler },
          { binding: 2, resource: { buffer: this.uniform } },
        ],
      }),
    );
    copy.draw(3);
    copy.end();
    this.device.queue.submit([encoder.finish()]);
    this.readIndex = writeIndex;
    this.samples += 1;
    this.report({
      backend: "WebGPU progressive path study",
      status: `${this.bounces} bounces`,
      samples: this.samples,
    });
    this.raf = requestAnimationFrame(this.render);
  };
}

const PATH_TRACER_WGSL = `
struct Params { resolution: vec2f, frame: f32, bounces: f32 }
@group(0) @binding(0) var previous: texture_2d<f32>;
@group(0) @binding(1) var nearestSampler: sampler;
@group(0) @binding(2) var<uniform> params: Params;
struct VOut { @builtin(position) position: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) index: u32) -> VOut {
  var positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var output: VOut; output.position = vec4f(positions[index], 0.0, 1.0); output.uv = positions[index] * 0.5 + vec2f(0.5); return output;
}
fn hash(value: f32) -> f32 { return fract(sin(value * 12.9898) * 43758.5453); }
fn sphere(origin: vec3f, direction: vec3f, center: vec3f, radius: f32) -> f32 {
  let oc = origin - center; let b = dot(oc, direction); let c = dot(oc, oc) - radius * radius; let h = b * b - c;
  if (h < 0.0) { return -1.0; } return -b - sqrt(h);
}
fn shade(uv: vec2f, seed: f32) -> vec3f {
  let p = (uv * 2.0 - 1.0) * vec2f(params.resolution.x / params.resolution.y, 1.0);
  var origin = vec3f(0.0, 0.25, -3.8); var direction = normalize(vec3f(p.x, -p.y, 1.7));
  var throughput = vec3f(1.0); var radiance = vec3f(0.0);
  for (var bounce = 0; bounce < 4; bounce = bounce + 1) {
    if (f32(bounce) >= params.bounces) { break; }
    let left = sphere(origin, direction, vec3f(-0.72, -0.48, 0.3), 0.62);
    let right = sphere(origin, direction, vec3f(0.72, -0.64, 0.78), 0.46);
    let floorT = (-1.12 - origin.y) / direction.y;
    var distance = 999.0; var normal = vec3f(0.0, 1.0, 0.0); var albedo = vec3f(0.72);
    if (floorT > 0.001 && floorT < distance) { distance = floorT; albedo = vec3f(0.72, 0.68, 0.59); }
    if (left > 0.001 && left < distance) { distance = left; normal = normalize(origin + direction * left - vec3f(-0.72, -0.48, 0.3)); albedo = vec3f(0.16, 0.72, 0.62); }
    if (right > 0.001 && right < distance) { distance = right; normal = normalize(origin + direction * right - vec3f(0.72, -0.64, 0.78)); albedo = vec3f(0.82, 0.58, 0.23); }
    if (distance > 998.0) { radiance = radiance + throughput * vec3f(0.04, 0.08, 0.09); break; }
    let hit = origin + direction * distance; let lightDirection = normalize(vec3f(-0.35, 1.0, -0.45));
    radiance = radiance + throughput * albedo * max(dot(normal, lightDirection), 0.0) * 0.72;
    let r1 = hash(seed + f32(bounce) * 17.0); let r2 = hash(seed + f32(bounce) * 43.0);
    let tangent = normalize(cross(select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(normal.y) > 0.9), normal));
    let bitangent = cross(normal, tangent); let phi = 6.2831853 * r1; let z = sqrt(r2); let radial = sqrt(1.0 - r2);
    direction = normalize(tangent * cos(phi) * radial + bitangent * sin(phi) * radial + normal * z);
    origin = hit + normal * 0.002; throughput = throughput * albedo;
  }
  return radiance;
}
@fragment fn fs(input: VOut) -> @location(0) vec4f {
  let uv = clamp(input.uv, vec2f(0.0), vec2f(0.999)); let old = textureSampleLevel(previous, nearestSampler, uv, 0.0).rgb;
  let sample = shade(uv, params.frame + uv.x * 71.0 + uv.y * 191.0); let weight = 1.0 / (params.frame + 1.0);
  let average = mix(old, sample, weight); let mapped = pow(average / (average + vec3f(1.0)), vec3f(1.0 / 2.2)); return vec4f(mapped, 1.0);
}`;

function drawSphere(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  roughness: number,
): void {
  const highlight = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.35, 0, x, y, radius);
  highlight.addColorStop(0, "#f7f4e7");
  highlight.addColorStop(Math.max(0.05, 1 - roughness), color);
  highlight.addColorStop(1, "#0b1716");
  ctx.fillStyle = highlight;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}
function deterministic(seed: number): number {
  return Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1;
}
