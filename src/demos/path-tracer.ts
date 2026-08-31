import {
  clearElement,
  createMetricReporter,
  drawStageBackdrop,
  makeButton,
  resizeCanvas,
} from "./core/canvas";
import type { DemoContext, DemoController } from "./core/types";
import { WebGpuPathTracer } from "./path-tracer/renderer";

interface PathRenderer {
  resize(width: number, height: number): void;
  setBounces(bounces: number): void;
  setUserPaused(paused: boolean): void;
  reset(): void;
  pause(): void;
  resume(): void;
  dispose(): void;
}

export function runningMean(previous: number, sample: number, sampleIndex: number): number {
  if (sampleIndex < 0) throw new Error("sampleIndex must be non-negative");
  return previous + (sample - previous) / (sampleIndex + 1);
}

export interface DielectricInterface {
  frontFace: boolean;
  orientedNormal: readonly [number, number, number];
  etaIncident: number;
  etaTransmitted: number;
  eta: number;
}

/**
 * Mirrors the geometric-normal / eta selection in PATH_COMPUTE_WGSL. Keeping this
 * tiny CPU reference makes the inside-to-outside branch testable without a GPU.
 */
export function resolveDielectricInterface(
  direction: readonly [number, number, number],
  geometricNormal: readonly [number, number, number],
  ior: number,
): DielectricInterface {
  if (!(ior > 0) || !Number.isFinite(ior)) throw new Error("IOR must be finite and positive");
  const normalLength = Math.hypot(...geometricNormal);
  if (!(normalLength > 1e-8)) throw new Error("Geometric normal must be non-zero");
  const normal: [number, number, number] = [
    geometricNormal[0] / normalLength,
    geometricNormal[1] / normalLength,
    geometricNormal[2] / normalLength,
  ];
  const frontFace =
    direction[0] * normal[0] + direction[1] * normal[1] + direction[2] * normal[2] < 0;
  const orientedNormal: [number, number, number] = frontFace
    ? normal
    : (normal.map((value) => (value === 0 ? 0 : -value)) as [number, number, number]);
  const etaIncident = frontFace ? 1 : ior;
  const etaTransmitted = frontFace ? ior : 1;
  return {
    frontFace,
    orientedNormal,
    etaIncident,
    etaTransmitted,
    eta: etaIncident / etaTransmitted,
  };
}

export function createDemo(): DemoController {
  let context: DemoContext;
  let active: PathRenderer | undefined;
  let bounces = 4;
  let userPaused = false;
  let running = false;
  let width = 1;
  let height = 1;
  let generation = 0;

  const useFallback = (reason: string, expectedGeneration: number) => {
    if (generation !== expectedGeneration) return;
    active?.dispose();
    const fallback = new CanvasPathFallback(context, bounces);
    fallback.resize(width, height);
    fallback.setUserPaused(userPaused);
    active = fallback;
    if (running) fallback.resume();
    context.setRuntimeState?.("fallback");
    context.setStatus(`${reason} Showing labeled CPU path-like fallback.`, "warning");
  };

  const setup = async () => {
    const currentGeneration = ++generation;
    active?.dispose();
    active = undefined;
    try {
      const renderer = await WebGpuPathTracer.create(context, bounces, width, height, (message) =>
        useFallback(message, currentGeneration),
      );
      if (generation !== currentGeneration) {
        renderer.dispose();
        return;
      }
      renderer.resize(width, height);
      renderer.setUserPaused(userPaused);
      active = renderer;
      if (running) renderer.resume();
      context.setRuntimeState?.("running");
      context.setStatus(
        "WebGPU compute path tracer active: CPU BVH, Diffuse/Metal/Dielectric materials, linear rgba16float accumulation and separate tone map.",
        "success",
      );
      context.setMetrics({
        backend: renderer.backendLabel,
        status: "0 SPP · reviewed linear accumulation",
        metricSource: "animation-frame",
      });
    } catch (error) {
      useFallback(
        error instanceof Error ? error.message : "WebGPU path tracer could not initialize.",
        currentGeneration,
      );
    }
  };

  return {
    async init(next) {
      context = next;
      clearElement(context.controls);
      const bounceValues = [1, 2, 3, 4];
      const bounceButtons = bounceValues.map((value) =>
        makeButton(`${value} BOUNCE${value === 1 ? "" : "S"}`, value === bounces),
      );
      bounceButtons.forEach((button, index) =>
        button.addEventListener(
          "click",
          () => {
            bounces = bounceValues[index];
            bounceButtons.forEach((entry) =>
              entry.setAttribute("aria-pressed", String(entry === button)),
            );
            active?.setBounces(bounces);
            context.setStatus(`Bounce limit changed to ${bounces}; accumulation reset.`, "success");
          },
          { signal: context.signal },
        ),
      );
      const pauseButton = makeButton("PAUSE", false);
      pauseButton.addEventListener(
        "click",
        () => {
          userPaused = !userPaused;
          pauseButton.setAttribute("aria-pressed", String(userPaused));
          pauseButton.textContent = userPaused ? "RESUME" : "PAUSE";
          active?.setUserPaused(userPaused);
        },
        { signal: context.signal },
      );
      const resetButton = makeButton("RESET SPP");
      resetButton.addEventListener(
        "click",
        () => {
          active?.reset();
          context.setStatus("Camera revision and accumulation reset to 0 SPP.", "success");
        },
        { signal: context.signal },
      );
      context.controls.append(...bounceButtons, pauseButton, resetButton);
      await setup();
    },
    resize(nextWidth, nextHeight) {
      width = Math.max(1, nextWidth);
      height = Math.max(1, nextHeight);
      active?.resize(width, height);
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

class CanvasPathFallback implements PathRenderer {
  private readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width = 1;
  private height = 1;
  private running = false;
  private userPaused = false;
  private raf = 0;
  private samples = 0;
  private readonly report: ReturnType<typeof createMetricReporter>;

  constructor(
    private readonly shell: DemoContext,
    private bounces: number,
  ) {
    this.canvas = mountFallbackCanvas(shell, "CPU path-tracing fallback visual output");
    this.ctx = resizeCanvas(this.canvas, 1, 1);
    this.report = createMetricReporter(shell);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.ctx = resizeCanvas(this.canvas, width, height);
    this.reset();
  }

  setBounces(bounces: number): void {
    this.bounces = bounces;
    this.reset();
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
    this.samples = 0;
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

  dispose(): void {
    this.pause();
    this.canvas.remove();
    this.shell.canvas.hidden = false;
  }

  private draw = (): void => {
    if (!this.running) return;
    this.raf = 0;
    if (this.userPaused) return;
    this.samples += 1;
    drawStageBackdrop(this.ctx, this.width, this.height);
    const room = {
      x: this.width * 0.18,
      y: this.height * 0.1,
      width: this.width * 0.64,
      height: this.height * 0.76,
    };
    this.ctx.fillStyle = "#b44f3f";
    this.ctx.fillRect(room.x, room.y, room.width * 0.08, room.height);
    this.ctx.fillStyle = "#3a7782";
    this.ctx.fillRect(room.x + room.width * 0.92, room.y, room.width * 0.08, room.height);
    this.ctx.fillStyle = "#cbc4b1";
    this.ctx.fillRect(room.x + room.width * 0.08, room.y, room.width * 0.84, room.height);
    this.ctx.fillStyle = "#d7a349";
    this.ctx.fillRect(this.width * 0.31, this.height * 0.52, this.width * 0.17, this.height * 0.25);
    this.ctx.fillStyle = "rgba(222,244,238,.72)";
    this.ctx.fillRect(this.width * 0.56, this.height * 0.43, this.width * 0.15, this.height * 0.34);
    const glow = this.ctx.createRadialGradient(
      this.width * 0.5,
      this.height * 0.18,
      1,
      this.width * 0.5,
      this.height * 0.18,
      this.width * 0.32,
    );
    glow.addColorStop(0, "rgba(255,244,201,.82)");
    glow.addColorStop(1, "rgba(255,244,201,0)");
    this.ctx.fillStyle = glow;
    this.ctx.fillRect(room.x, room.y, room.width, room.height);
    this.ctx.fillStyle = "#071011";
    this.ctx.font = "12px ui-monospace, monospace";
    this.ctx.fillText("CPU STATIC FALLBACK · NO GPU TIMING", 16, 24);
    this.ctx.fillText(
      `${this.bounces} BOUNCES · VISUAL SAMPLE ${this.samples}`,
      16,
      this.height - 16,
    );
    this.report({
      backend: "Canvas fallback",
      status: `${this.samples} visual samples · ${this.bounces} bounces`,
      samples: this.samples,
      metricSource: "animation-frame",
    });
    this.schedule();
  };

  private schedule(): void {
    if (!this.running || this.userPaused || this.raf) return;
    this.raf = requestAnimationFrame(this.draw);
  }
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
