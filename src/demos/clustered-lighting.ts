import { clearElement, drawStageBackdrop, makeButton } from "./core/canvas";
import { OneAttemptDeviceRecoveryGate } from "./core/runtime";
import type { DemoContext, DemoController } from "./core/types";
import { CanvasFallbackSurface } from "./reference-frame/fallback-surface";
import { buildProceduralResearchCourtyard } from "./research-courtyard/scene";
import {
  CLUSTER_LIGHT_COUNTS,
  CLUSTER_VIEWS,
  DEFAULT_CLUSTER_GRID,
  LIGHTING_MODES,
  buildClusteredLightAssignments,
  buildDynamicLights,
  type ClusterView,
  type LightingMode,
} from "./clustered-lighting/core";
import {
  WebGpuClusteredLightingRenderer,
  type ClusteredLightingRenderer,
} from "./clustered-lighting/renderer";

type ActiveRenderer = ClusteredLightingRenderer;

const MODE_LABEL: Record<LightingMode, string> = {
  naive: "NAIVE",
  deferred: "DEFERRED",
  clustered: "CLUSTERED",
};
const VIEW_LABEL: Record<ClusterView, string> = {
  final: "FINAL",
  gbuffer: "G-BUFFER",
  "depth-slice": "DEPTH SLICE",
  "cluster-heatmap": "CLUSTER HEATMAP",
};

export function createDemo(): DemoController {
  let context: DemoContext;
  let active: ActiveRenderer | undefined;
  let mode: LightingMode = "clustered";
  let view: ClusterView = "final";
  let lightCount: (typeof CLUSTER_LIGHT_COUNTS)[number] = 256;
  let width = 1;
  let height = 1;
  let running = false;
  let generation = 0;
  const deviceRecovery = new OneAttemptDeviceRecoveryGate();

  const applyState = () => {
    active?.setMode(mode);
    active?.setView(view);
    active?.setLightCount(lightCount);
  };

  const useFallback = (reason: string, expectedGeneration: number) => {
    if (generation !== expectedGeneration) return;
    active?.dispose();
    active = undefined;
    let fallback: CanvasClusteredLightingFallback | undefined;
    try {
      fallback = new CanvasClusteredLightingFallback(context);
      fallback.resize(width, height);
      fallback.setMode(mode);
      fallback.setView(view);
      fallback.setLightCount(lightCount);
      active = fallback;
      if (running) fallback.resume();
      context.setRuntimeState?.("fallback");
      context.setStatus(
        `${reason} Canvas diagnostic fallback: CPU reference values only, not GPU timing.`,
        "warning",
      );
    } catch (error) {
      fallback?.dispose();
      context.setStatus(
        `${reason} ${error instanceof Error ? error.message : "Canvas fallback unavailable."}`,
        "error",
      );
    }
  };

  const setup = async (recoveringFromDeviceLoss = false) => {
    if (!recoveringFromDeviceLoss) deviceRecovery.reset();
    const currentGeneration = ++generation;
    active?.dispose();
    active = undefined;
    let renderer: WebGpuClusteredLightingRenderer | undefined;
    try {
      renderer = await WebGpuClusteredLightingRenderer.create(context, (message) => {
        if (generation !== currentGeneration) return;
        if (deviceRecovery.takeAttempt()) {
          context.setStatus(message + " Rebuilding the current mode once.", "warning");
          void setup(true).finally(() => deviceRecovery.finishAttempt());
          return;
        }
        const fallbackGeneration = ++generation;
        useFallback(message + " Rebuild already attempted.", fallbackGeneration);
      });
      if (currentGeneration !== generation) {
        renderer.dispose();
        return;
      }
      renderer.resize(width, height);
      renderer.setMode(mode);
      renderer.setView(view);
      renderer.setLightCount(lightCount);
      active = renderer;
      context.setRuntimeState?.("running");
      context.setStatus(
        `Raw WebGPU Research Courtyard: ${renderer.scenePrimitiveCount} CPU-built primitives; GPU Compute writes cluster lists and CPU verifies 64-light readbacks.`,
        "success",
      );
      if (running) renderer.resume();
    } catch (error) {
      renderer?.dispose();
      useFallback(
        error instanceof Error ? error.message : "WebGPU lighting could not initialize.",
        currentGeneration,
      );
    }
  };

  return {
    async init(next) {
      context = next;
      clearElement(context.controls);
      const modeButtons = LIGHTING_MODES.map((candidate) =>
        makeButton(MODE_LABEL[candidate], candidate === mode),
      );
      const countButtons = CLUSTER_LIGHT_COUNTS.map((candidate) =>
        makeButton(`${candidate} LIGHTS`, candidate === lightCount),
      );
      const viewButtons = CLUSTER_VIEWS.map((candidate) =>
        makeButton(VIEW_LABEL[candidate], candidate === view),
      );
      modeButtons.forEach((button, index) => {
        button.addEventListener(
          "click",
          () => {
            mode = LIGHTING_MODES[index];
            modeButtons.forEach((entry) =>
              entry.setAttribute("aria-pressed", String(entry === button)),
            );
            active?.setMode(mode);
          },
          { signal: context.signal },
        );
      });
      countButtons.forEach((button, index) => {
        button.addEventListener(
          "click",
          () => {
            lightCount = CLUSTER_LIGHT_COUNTS[index];
            countButtons.forEach((entry) =>
              entry.setAttribute("aria-pressed", String(entry === button)),
            );
            active?.setLightCount(lightCount);
          },
          { signal: context.signal },
        );
      });
      viewButtons.forEach((button, index) => {
        button.addEventListener(
          "click",
          () => {
            view = CLUSTER_VIEWS[index];
            viewButtons.forEach((entry) =>
              entry.setAttribute("aria-pressed", String(entry === button)),
            );
            active?.setView(view);
          },
          { signal: context.signal },
        );
      });
      context.controls.append(...modeButtons, ...countButtons, ...viewButtons);
      await setup();
      applyState();
    },
    resize(nextWidth, nextHeight) {
      width = Math.max(1, nextWidth);
      height = Math.max(1, nextHeight);
      try {
        active?.resize(width, height);
      } catch (error) {
        const fallbackGeneration = ++generation;
        useFallback(
          error instanceof Error ? error.message : "Clustered lighting resize failed.",
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

class CanvasClusteredLightingFallback implements ClusteredLightingRenderer {
  readonly backendLabel = "Canvas diagnostic fallback";
  readonly scenePrimitiveCount = buildProceduralResearchCourtyardCount();
  private readonly surface: CanvasFallbackSurface;
  private ctx: CanvasRenderingContext2D;
  private width = 1;
  private height = 1;
  private mode: LightingMode = "clustered";
  private view: ClusterView = "final";
  private lightCount: (typeof CLUSTER_LIGHT_COUNTS)[number] = 256;
  private disposed = false;

  constructor(private readonly shell: DemoContext) {
    this.surface = new CanvasFallbackSurface(
      shell,
      "Clustered lighting Canvas diagnostic fallback",
    );
    this.ctx = this.surface.resize(1, 1);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.ctx = this.surface.resize(width, height);
    this.draw();
  }

  setMode(mode: LightingMode): void {
    this.mode = mode;
    this.draw();
  }

  setLightCount(count: (typeof CLUSTER_LIGHT_COUNTS)[number]): void {
    this.lightCount = count;
    this.draw();
  }

  setView(view: ClusterView): void {
    this.view = view;
    this.draw();
  }

  pause(): void {}

  resume(): void {
    this.draw();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.surface.dispose();
  }

  private draw(): void {
    if (this.disposed) return;
    drawStageBackdrop(this.ctx, this.width, this.height);
    const lights = buildDynamicLights(this.lightCount, 0);
    const assignment = buildClusteredLightAssignments(lights, DEFAULT_CLUSTER_GRID);
    if (this.view === "cluster-heatmap") this.drawHeatmap(assignment);
    else if (this.view === "depth-slice") this.drawDepthSlices();
    else if (this.view === "gbuffer") this.drawGBuffer();
    else this.drawCourtyard(lights);
    this.ctx.fillStyle = "#e8e6dc";
    this.ctx.font = "11px ui-monospace, monospace";
    this.ctx.fillText(
      `CANVAS FALLBACK | ${MODE_LABEL[this.mode]} | ${this.lightCount} LIGHTS | CPU LIST ${assignment.storedAssignments} | GPU TIME UNAVAILABLE`,
      14,
      Math.max(22, this.height - 14),
    );
    this.shell.setMetrics({
      backend: this.backendLabel,
      status: `CPU diagnostic only | overflow ${assignment.overflow} | no GPU timestamp`,
      metricSource: "unavailable",
    });
  }

  private drawCourtyard(lights: ReturnType<typeof buildDynamicLights>): void {
    const ctx = this.ctx;
    const horizon = this.height * 0.37;
    ctx.fillStyle = "#172523";
    ctx.fillRect(0, 0, this.width, horizon);
    ctx.fillStyle = "#30332c";
    ctx.beginPath();
    ctx.moveTo(0, this.height);
    ctx.lineTo(this.width, this.height);
    ctx.lineTo(this.width * 0.62, horizon);
    ctx.lineTo(this.width * 0.38, horizon);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#553019";
    ctx.fillRect(this.width * 0.43, horizon - 12, this.width * 0.14, this.height * 0.23);
    ctx.fillStyle = "#f0a338";
    ctx.fillRect(this.width * 0.27, horizon - 18, 9, this.height * 0.34);
    ctx.fillRect(this.width * 0.73 - 9, horizon - 18, 9, this.height * 0.34);
    const sample = lights.slice(0, Math.min(42, lights.length));
    for (const light of sample) {
      const x = (light.position[0] * 0.5 + 0.5) * this.width;
      const y =
        horizon + (light.position[2] / DEFAULT_CLUSTER_GRID.far) * (this.height - horizon) * 0.55;
      const radius = 1.5 + light.radius * 2.3;
      ctx.fillStyle = `rgba(${Math.round(light.color[0] * 255)}, ${Math.round(light.color[1] * 255)}, ${Math.round(light.color[2] * 255)}, .75)`;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawGBuffer(): void {
    const tileWidth = this.width / 2;
    const tileHeight = this.height / 2;
    const tiles: Array<[string, string]> = [
      ["#547a6d", "ALBEDO"],
      ["#8c78c5", "WORLD NORMAL"],
      ["#d3a153", "ROUGHNESS"],
      ["#596d7d", "LINEAR DEPTH"],
    ];
    tiles.forEach(([color, label], index) => {
      const x = (index % 2) * tileWidth;
      const y = Math.floor(index / 2) * tileHeight;
      this.ctx.fillStyle = color;
      this.ctx.fillRect(x + 6, y + 6, tileWidth - 12, tileHeight - 12);
      this.ctx.fillStyle = "#071011";
      this.ctx.font = "12px ui-monospace, monospace";
      this.ctx.fillText(label, x + 16, y + 26);
    });
  }

  private drawDepthSlices(): void {
    const sliceWidth = this.width / DEFAULT_CLUSTER_GRID.z;
    for (let slice = 0; slice < DEFAULT_CLUSTER_GRID.z; slice += 1) {
      const t = slice / Math.max(1, DEFAULT_CLUSTER_GRID.z - 1);
      this.ctx.fillStyle = `hsl(${185 - t * 145} 72% ${18 + t * 48}%)`;
      this.ctx.fillRect(slice * sliceWidth, 0, sliceWidth + 1, this.height);
      this.ctx.fillStyle = "#e8e6dc";
      this.ctx.font = "10px ui-monospace, monospace";
      this.ctx.fillText(`Z${slice}`, slice * sliceWidth + 5, 22);
    }
  }

  private drawHeatmap(assignment: ReturnType<typeof buildClusteredLightAssignments>): void {
    const columns = DEFAULT_CLUSTER_GRID.x;
    const rows = DEFAULT_CLUSTER_GRID.y;
    const selectedLayer = Math.floor(DEFAULT_CLUSTER_GRID.z / 2);
    const offset = selectedLayer * columns * rows;
    const cellWidth = this.width / columns;
    const cellHeight = this.height / rows;
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        const count = assignment.headers[offset + y * columns + x].count;
        const t = count / DEFAULT_CLUSTER_GRID.maxLightsPerCluster;
        this.ctx.fillStyle = `hsl(${180 - t * 145} 74% ${14 + t * 48}%)`;
        this.ctx.fillRect(x * cellWidth + 1, y * cellHeight + 1, cellWidth - 2, cellHeight - 2);
        this.ctx.fillStyle = "#e8e6dc";
        this.ctx.font = "10px ui-monospace, monospace";
        this.ctx.fillText(String(count), x * cellWidth + 5, y * cellHeight + 16);
      }
    }
  }
}

function buildProceduralResearchCourtyardCount(): number {
  return buildProceduralResearchCourtyard().boxes.length;
}
