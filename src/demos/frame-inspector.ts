import { clearElement, drawStageBackdrop, makeButton } from "./core/canvas";
import { OneAttemptDeviceRecoveryGate } from "./core/runtime";
import type { DemoContext, DemoController } from "./core/types";
import { CanvasFallbackSurface } from "./reference-frame/fallback-surface";
import { ReferenceFrameRenderer } from "./reference-frame/renderer";
import {
  REFERENCE_ATTACHMENTS,
  attachmentInfo,
  type AttachmentInfo,
  type ReferenceHistogram,
  type ReferencePixelProbe,
  type ReferenceView,
} from "./reference-frame/types";

export const BUFFER_VIEWS: readonly ReferenceView[] = REFERENCE_ATTACHMENTS.map(
  (entry) => entry.view,
);

const CELL_GAP = 10;
const NARROW_LAYOUT_BREAKPOINT = 540;

export interface FrameInspectorLayout {
  columns: number;
  rows: number;
  gap: number;
  cellWidth: number;
  cellHeight: number;
}

export function calculateFrameInspectorLayout(
  width: number,
  height: number,
): FrameInspectorLayout | undefined {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    return undefined;
  const columns = width < NARROW_LAYOUT_BREAKPOINT ? 2 : 4;
  const rows = Math.ceil(BUFFER_VIEWS.length / columns);
  const availableWidth = width - CELL_GAP * (columns + 1);
  const availableHeight = height - CELL_GAP * (rows + 1);
  if (availableWidth <= 0 || availableHeight <= 0) return undefined;
  return {
    columns,
    rows,
    gap: CELL_GAP,
    cellWidth: availableWidth / columns,
    cellHeight: availableHeight / rows,
  };
}

export function bufferViewAtPoint(
  layout: FrameInspectorLayout,
  x: number,
  y: number,
): ReferenceView | undefined {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  const column = Math.floor((x - layout.gap) / (layout.cellWidth + layout.gap));
  const row = Math.floor((y - layout.gap) / (layout.cellHeight + layout.gap));
  if (column < 0 || column >= layout.columns || row < 0 || row >= layout.rows) return undefined;
  const cellX = layout.gap + column * (layout.cellWidth + layout.gap);
  const cellY = layout.gap + row * (layout.cellHeight + layout.gap);
  if (x > cellX + layout.cellWidth || y > cellY + layout.cellHeight) return undefined;
  return BUFFER_VIEWS[row * layout.columns + column];
}

interface InspectorRenderer {
  readonly isFallback: boolean;
  readonly historyStatus: string;
  resize(width: number, height: number): void;
  getAttachmentInfo(view: ReferenceView): AttachmentInfo;
  probe?(view: ReferenceView, u: number, v: number): Promise<ReferencePixelProbe | undefined>;
  histogram?(view: ReferenceView): Promise<ReferenceHistogram | undefined>;
  setView(view: ReferenceView): void;
  setFrozen(frozen: boolean): void;
  pause(): void;
  resume(): void;
  dispose(): void;
}

export function createDemo(): DemoController {
  let context: DemoContext;
  let active: InspectorRenderer | undefined;
  let selected: ReferenceView = "final";
  let frozen = false;
  let generation = 0;
  let running = false;
  let width = 1;
  let height = 1;
  const deviceRecovery = new OneAttemptDeviceRecoveryGate();

  const updateEvidence = () => {
    const info = active?.getAttachmentInfo(selected) ?? attachmentInfo(selected);
    const isFallback = active?.isFallback ?? true;
    context.setStatus(
      `${info.label} | ${info.format} | ${info.range} | last writer: ${info.lastWriter} | history: ${active?.historyStatus ?? "unavailable"} | ${isFallback ? "Canvas atlas, not GPU attachment data" : "display transform: ACES + sRGB"}`,
      isFallback ? "warning" : "success",
    );
  };

  const select = (view: ReferenceView) => {
    selected = view;
    active?.setView(view);
    updateEvidence();
  };

  const useFallback = async (reason: string, expectedGeneration: number) => {
    if (expectedGeneration !== generation) return;
    active?.dispose();
    active = undefined;
    let fallback: CanvasInspectorFallback | undefined;
    try {
      fallback = new CanvasInspectorFallback(context, selected);
      fallback.resize(width, height);
      fallback.setFrozen(frozen);
      active = fallback;
      if (running) fallback.resume();
      context.setRuntimeState?.("fallback");
      context.setMetrics({ backend: "Canvas fallback", status: "STATIC ATTACHMENT ATLAS" });
      context.setStatus(`${reason} Showing deterministic attachment atlas.`, "warning");
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
        view: selected,
        shadow: "pcf",
        aa: "taa",
        onDeviceLost: (message) => {
          if (generation !== currentGeneration) return;
          if (deviceRecovery.takeAttempt()) {
            context.setStatus(`${message} Reinitializing WebGPU once…`, "warning");
            void setup(true).finally(() => deviceRecovery.finishAttempt());
            return;
          }
          const fallbackGeneration = ++generation;
          void useFallback(message, fallbackGeneration);
        },
      });
      if (currentGeneration !== generation) {
        renderer.dispose();
        return;
      }
      renderer.resize(width, height);
      renderer.setFrozen(frozen);
      if (currentGeneration !== generation) {
        renderer.dispose();
        return;
      }
      active = renderer;
      if (running) renderer.resume();
      context.setRuntimeState?.("running");
      context.setStatus(
        "Live Reference Frame attachments include its local Cluster Light Count; the separate Clustered Lighting demo still owns a different WebGPU device and textures.",
        "success",
      );
      context.setMetrics({ backend: renderer.backendLabel, status: "LIVE ATTACHMENTS" });
      if (recoveringDevice)
        context.setStatus(
          "WebGPU reinitialized after device loss; attachment history restarted.",
          "success",
        );
    } catch (error) {
      renderer?.dispose();
      await useFallback(
        error instanceof Error ? error.message : "Reference frame could not initialize.",
        currentGeneration,
      );
    }
  };

  return {
    async init(next) {
      context = next;
      clearElement(context.controls);
      const viewButtons = BUFFER_VIEWS.map((view) => {
        const button = makeButton(attachmentInfo(view).label, view === selected);
        button.addEventListener(
          "click",
          () => {
            viewButtons.forEach((entry) =>
              entry.setAttribute("aria-pressed", String(entry === button)),
            );
            select(view);
          },
          { signal: context.signal },
        );
        return button;
      });
      const freezeButton = makeButton("FREEZE FRAME", false);
      freezeButton.addEventListener(
        "click",
        () => {
          frozen = !frozen;
          freezeButton.setAttribute("aria-pressed", String(frozen));
          freezeButton.textContent = frozen ? "RESUME FRAME" : "FREEZE FRAME";
          active?.setFrozen(frozen);
        },
        { signal: context.signal },
      );
      let probeArmed = false;
      const probeButton = makeButton("PIXEL PROBE", false);
      probeButton.addEventListener(
        "click",
        () => {
          probeArmed = !probeArmed;
          probeButton.setAttribute("aria-pressed", String(probeArmed));
          context.setStatus(
            probeArmed
              ? "Pixel Probe armed: click the render area to read the selected real attachment."
              : "Pixel Probe disabled.",
            "info",
          );
        },
        { signal: context.signal },
      );
      context.stage.addEventListener(
        "click",
        (event) => {
          if (!probeArmed) return;
          const bounds = context.stage.getBoundingClientRect();
          const u = (event.clientX - bounds.left) / Math.max(1, bounds.width);
          const v = (event.clientY - bounds.top) / Math.max(1, bounds.height);
          void active?.probe?.(selected, u, v).then((probe) => {
            if (!probe) {
              context.setStatus(
                "Pixel Probe is unavailable for Final or Canvas fallback; choose a real attachment.",
                "warning",
              );
              return;
            }
            context.setStatus(
              `PIXEL ${probe.x},${probe.y} | ${probe.interpretation} | [${probe.values.map((value) => value.toFixed(4)).join(", ")}]`,
              "success",
            );
          });
        },
        { signal: context.signal },
      );
      const histogramButton = makeButton("HISTOGRAM 64");
      histogramButton.addEventListener(
        "click",
        () => {
          histogramButton.disabled = true;
          void active
            ?.histogram?.(selected)
            .then((histogram) => {
              if (!histogram) {
                context.setStatus(
                  "Histogram is unavailable for Final or Canvas fallback; choose a real attachment.",
                  "warning",
                );
                return;
              }
              const peak = histogram.bins.reduce(
                (best, value, index) => (value > histogram.bins[best] ? index : best),
                0,
              );
              context.setStatus(
                `HISTOGRAM 64 | ${histogram.samples} sampled pixels | peak bin ${peak} | ${histogram.interpretation}`,
                "success",
              );
            })
            .catch((error: unknown) => {
              context.setStatus(
                `Histogram readback failed: ${error instanceof Error ? error.message : "unknown failure"}`,
                "error",
              );
            })
            .finally(() => {
              histogramButton.disabled = false;
            });
        },
        { signal: context.signal },
      );
      context.controls.append(...viewButtons, freezeButton, probeButton, histogramButton);
      await setup();
      updateEvidence();
    },
    resize(nextWidth, nextHeight) {
      width = Math.max(1, nextWidth);
      height = Math.max(1, nextHeight);
      try {
        active?.resize(width, height);
      } catch (error) {
        const fallbackGeneration = ++generation;
        void useFallback(
          error instanceof Error ? error.message : "Frame Inspector resize failed.",
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

class CanvasInspectorFallback implements InspectorRenderer {
  readonly isFallback = true;
  private readonly surface: CanvasFallbackSurface;
  private ctx: CanvasRenderingContext2D;
  private width = 1;
  private height = 1;
  private selected: ReferenceView;
  private running = false;
  private frozen = false;

  constructor(shell: DemoContext, selected: ReferenceView) {
    this.selected = selected;
    this.surface = new CanvasFallbackSurface(shell, "Frame Inspector static attachment atlas");
    this.ctx = this.surface.resize(1, 1);
  }

  get historyStatus(): string {
    return "static atlas / no temporal GPU history";
  }

  getAttachmentInfo(view: ReferenceView): AttachmentInfo {
    return attachmentInfo(view);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.ctx = this.surface.resize(width, height);
    this.draw();
  }

  setView(view: ReferenceView): void {
    this.selected = view;
    this.draw();
  }

  setFrozen(frozen: boolean): void {
    this.frozen = frozen;
    this.draw();
  }

  pause(): void {
    this.running = false;
  }

  resume(): void {
    this.running = true;
    this.draw();
  }

  dispose(): void {
    this.running = false;
    this.surface.dispose();
  }

  private draw(): void {
    drawStageBackdrop(this.ctx, this.width, this.height);
    const layout = calculateFrameInspectorLayout(this.width, this.height);
    if (!layout) return;
    BUFFER_VIEWS.forEach((view, index) => {
      const x = layout.gap + (index % layout.columns) * (layout.cellWidth + layout.gap);
      const y = layout.gap + Math.floor(index / layout.columns) * (layout.cellHeight + layout.gap);
      this.drawTile(view, x, y, layout.cellWidth, layout.cellHeight);
    });
    this.ctx.fillStyle = "rgba(232,230,220,.72)";
    this.ctx.font = "11px ui-monospace, monospace";
    this.ctx.fillText(
      `STATIC ATTACHMENT ATLAS · ${this.frozen ? "FROZEN" : this.running ? "READY" : "PAUSED"}`,
      16,
      this.height - 13,
    );
  }

  private drawTile(view: ReferenceView, x: number, y: number, width: number, height: number): void {
    const selected = view === this.selected;
    const gradients: Record<ReferenceView, [string, string]> = {
      final: ["#1c3f39", "#1b120a"],
      albedo: ["#2dbe9e", "#dc761c"],
      normal: ["#7558c8", "#3cc99e"],
      depth: ["#eee7d2", "#14201f"],
      velocity: ["#11131c", "#f0b84b"],
      lighting: ["#fff1ad", "#6b3b13"],
      ssao: ["#e0ded1", "#4b5550"],
      history: ["#57e3c2", "#18343c"],
      "history-reject": ["#f0b84b", "#652a1e"],
      "cluster-light-count": ["#0f2c35", "#f0b84b"],
    };
    const gradient = this.ctx.createLinearGradient(x, y, x + width, y + height);
    gradient.addColorStop(0, gradients[view][0]);
    gradient.addColorStop(1, gradients[view][1]);
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(x, y, width, height);
    this.ctx.strokeStyle = selected ? "#57e3c2" : "rgba(232,230,220,.3)";
    this.ctx.lineWidth = selected ? 2 : 1;
    this.ctx.strokeRect(x, y, width, height);
    this.ctx.fillStyle = selected ? "#071011" : "#e8e6dc";
    this.ctx.font = "10px ui-monospace, monospace";
    this.ctx.fillText(attachmentInfo(view).label, x + 8, y + 16);
  }
}
