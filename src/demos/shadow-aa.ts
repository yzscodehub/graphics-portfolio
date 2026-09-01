import { clearElement, createMetricReporter, drawStageBackdrop, makeButton } from "./core/canvas";
import { OneAttemptDeviceRecoveryGate } from "./core/runtime";
import type { DemoContext, DemoController } from "./core/types";
import { CanvasFallbackSurface } from "./reference-frame/fallback-surface";
import { ReferenceFrameRenderer } from "./reference-frame/renderer";
import type { AaTechnique, ReferenceView, ShadowTechnique } from "./reference-frame/types";

interface ShadowAaRenderer {
  resize(width: number, height: number): void;
  setShadow(mode: ShadowTechnique): void;
  setAa(mode: AaTechnique): void;
  setView(view: ReferenceView): void;
  reset(): void;
  pause(): void;
  resume(): void;
  dispose(): void;
}

export function createDemo(): DemoController {
  let context: DemoContext;
  let active: ShadowAaRenderer | undefined;
  let shadow: ShadowTechnique = "pcf";
  let aa: AaTechnique = "taa";
  let view: ReferenceView = "final";
  let width = 1;
  let height = 1;
  let running = false;
  let generation = 0;
  const deviceRecovery = new OneAttemptDeviceRecoveryGate();

  const status = () => {
    context.setStatus(
      `${shadow.toUpperCase()} shadow filtering · ${aa.toUpperCase()} anti-aliasing · shared reference frame`,
      "success",
    );
    if (view === "history-reject" && active instanceof CanvasShadowAaFallback === false) {
      context.setStatus(
        "HISTORY REJECT is a live Temporal Resolve attachment: white means rejected history, black means accepted history.",
        "success",
      );
    }
    if (active instanceof CanvasShadowAaFallback) {
      context.setStatus(
        `Canvas fallback | ${shadow.toUpperCase()} shadow approximation | ${aa.toUpperCase()} temporal illustration`,
        "warning",
      );
    }
  };

  const useFallback = (reason: string, expectedGeneration: number) => {
    if (generation !== expectedGeneration) return;
    active?.dispose();
    active = undefined;
    let fallback: CanvasShadowAaFallback | undefined;
    try {
      fallback = new CanvasShadowAaFallback(context, shadow, aa);
      fallback.resize(width, height);
      fallback.setView(view);
      active = fallback;
      if (running) fallback.resume();
      context.setRuntimeState?.("fallback");
      context.setMetrics({ backend: "Canvas fallback", status: `${shadow} / ${aa}` });
      context.setStatus(`${reason} Showing labeled Canvas comparison.`, "warning");
    } catch (error) {
      fallback?.dispose();
      const fallbackError = error instanceof Error ? error.message : "Canvas fallback unavailable.";
      context.setStatus(`${reason} ${fallbackError}`, "error");
    }
  };

  const setup = async (recoveringDevice = false) => {
    const currentGeneration = ++generation;
    active?.dispose();
    active = undefined;
    let renderer: ReferenceFrameRenderer | undefined;
    try {
      renderer = await ReferenceFrameRenderer.create(context, {
        view,
        shadow,
        aa,
        onDeviceLost: (message) => {
          if (generation !== currentGeneration) return;
          if (deviceRecovery.takeAttempt()) {
            context.setStatus(`${message} Reinitializing WebGPU once…`, "warning");
            void setup(true).finally(() => deviceRecovery.finishAttempt());
            return;
          }
          const fallbackGeneration = ++generation;
          useFallback(message, fallbackGeneration);
        },
      });
      if (generation !== currentGeneration) {
        renderer.dispose();
        return;
      }
      renderer.resize(width, height);
      renderer.setView(view);
      if (currentGeneration !== generation) {
        renderer.dispose();
        return;
      }
      active = renderer;
      if (running) renderer.resume();
      context.setRuntimeState?.("running");
      context.setMetrics({ backend: renderer.backendLabel, status: `${shadow} / ${aa}` });
      status();
      if (recoveringDevice)
        context.setStatus(
          `WebGPU reinitialized after device loss | ${shadow.toUpperCase()} / ${aa.toUpperCase()}`,
          "success",
        );
    } catch (error) {
      renderer?.dispose();
      useFallback(
        error instanceof Error ? error.message : "WebGPU reference frame could not initialize.",
        currentGeneration,
      );
    }
  };

  return {
    async init(next) {
      context = next;
      clearElement(context.controls);
      const shadowModes: ShadowTechnique[] = ["hard", "pcf", "pcss"];
      const aaModes: AaTechnique[] = ["none", "fxaa", "taa"];
      const shadowButtons = shadowModes.map((mode) =>
        makeButton(`SHADOW ${mode.toUpperCase()}`, mode === shadow),
      );
      const aaButtons = aaModes.map((mode) => makeButton(`AA ${mode.toUpperCase()}`, mode === aa));
      shadowButtons.forEach((button, index) =>
        button.addEventListener(
          "click",
          () => {
            shadow = shadowModes[index];
            shadowButtons.forEach((entry) =>
              entry.setAttribute("aria-pressed", String(entry === button)),
            );
            active?.setShadow(shadow);
            status();
          },
          { signal: context.signal },
        ),
      );
      aaButtons.forEach((button, index) =>
        button.addEventListener(
          "click",
          () => {
            aa = aaModes[index];
            aaButtons.forEach((entry) =>
              entry.setAttribute("aria-pressed", String(entry === button)),
            );
            active?.setAa(aa);
            status();
          },
          { signal: context.signal },
        ),
      );
      const views: ReferenceView[] = ["final", "history-reject"];
      const viewButtons = views.map((candidate) =>
        makeButton(candidate === "final" ? "VIEW FINAL" : "VIEW REJECT MASK", candidate === view),
      );
      viewButtons.forEach((button, index) =>
        button.addEventListener(
          "click",
          () => {
            view = views[index];
            viewButtons.forEach((entry) =>
              entry.setAttribute("aria-pressed", String(entry === button)),
            );
            active?.setView(view);
            status();
          },
          { signal: context.signal },
        ),
      );
      const resetButton = makeButton("RESET HISTORY");
      resetButton.addEventListener(
        "click",
        () => {
          active?.reset();
          context.setStatus("Temporal history and deterministic scene time reset.", "success");
        },
        { signal: context.signal },
      );
      context.controls.append(...shadowButtons, ...aaButtons, ...viewButtons, resetButton);
      await setup();
    },
    resize(nextWidth, nextHeight) {
      width = Math.max(1, nextWidth);
      height = Math.max(1, nextHeight);
      try {
        active?.resize(width, height);
      } catch (error) {
        const fallbackGeneration = ++generation;
        useFallback(
          error instanceof Error ? error.message : "Shadow and anti-aliasing resize failed.",
          fallbackGeneration,
        );
      }
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

class CanvasShadowAaFallback implements ShadowAaRenderer {
  private readonly surface: CanvasFallbackSurface;
  private ctx: CanvasRenderingContext2D;
  private width = 1;
  private height = 1;
  private running = false;
  private raf = 0;
  private previousOffset = 0;
  private view: ReferenceView = "final";
  private startedAt = performance.now();
  private readonly report: ReturnType<typeof createMetricReporter>;

  constructor(
    shell: DemoContext,
    private shadow: ShadowTechnique,
    private aa: AaTechnique,
  ) {
    this.surface = new CanvasFallbackSurface(shell, "Shadow and anti-aliasing static comparison");
    this.ctx = this.surface.resize(1, 1);
    this.report = createMetricReporter(shell);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.ctx = this.surface.resize(width, height);
  }

  setShadow(mode: ShadowTechnique): void {
    this.shadow = mode;
  }

  setAa(mode: AaTechnique): void {
    this.aa = mode;
    this.previousOffset = 0;
  }

  setView(view: ReferenceView): void {
    this.view = view;
  }

  reset(): void {
    this.startedAt = performance.now();
    this.previousOffset = 0;
  }

  pause(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  resume(): void {
    if (this.running) return;
    this.running = true;
    this.raf = requestAnimationFrame(this.draw);
  }

  dispose(): void {
    this.pause();
    this.surface.dispose();
  }

  private draw = (now: number): void => {
    if (!this.running) return;
    const time = (now - this.startedAt) * 0.001;
    drawStageBackdrop(this.ctx, this.width, this.height);
    const pulse = Math.sin(time) * 7;
    const x = this.width * 0.47 + pulse;
    const y = this.height * 0.45;
    const radius = Math.min(this.width, this.height) * 0.16;
    this.ctx.fillStyle = "#172a29";
    this.ctx.fillRect(0, this.height * 0.68, this.width, this.height * 0.32);
    const blur = this.shadow === "hard" ? 0 : this.shadow === "pcf" ? 9 : 22;
    this.ctx.save();
    this.ctx.filter = blur ? `blur(${blur}px)` : "none";
    this.ctx.fillStyle = "rgba(0,0,0,.65)";
    this.ctx.beginPath();
    this.ctx.ellipse(
      x + radius * 0.8,
      this.height * 0.7,
      radius * 1.05,
      radius * 0.25,
      -0.25,
      0,
      Math.PI * 2,
    );
    this.ctx.fill();
    this.ctx.restore();
    if (this.aa === "taa") {
      this.ctx.save();
      this.ctx.globalAlpha = 0.16;
      this.ctx.fillStyle = "#f0b84b";
      this.ctx.beginPath();
      this.ctx.arc(x + this.previousOffset, y, radius, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
      this.previousOffset = pulse;
    }
    const gradient = this.ctx.createRadialGradient(
      x - radius * 0.3,
      y - radius * 0.4,
      radius * 0.04,
      x,
      y,
      radius * 1.1,
    );
    gradient.addColorStop(0, "#e8e6dc");
    gradient.addColorStop(0.42, "#57e3c2");
    gradient.addColorStop(1, "#0f5c54");
    this.ctx.fillStyle = gradient;
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.fillStyle = "#e8e6dc";
    this.ctx.font = "12px ui-monospace, monospace";
    this.ctx.fillText(
      `CANVAS FALLBACK · ${this.shadow.toUpperCase()} / ${this.aa.toUpperCase()}`,
      16,
      24,
    );
    this.report({
      backend: "Canvas fallback",
      status: `${this.shadow.toUpperCase()} / ${this.aa.toUpperCase()} / ${this.view === "history-reject" ? "REJECT ILLUSTRATION" : "FINAL"}`,
    });
    this.raf = requestAnimationFrame(this.draw);
  };
}
