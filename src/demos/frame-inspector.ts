import { clearElement, drawStageBackdrop, makeButton } from "./core/canvas";
import type { DemoContext, DemoController } from "./core/types";
import { CanvasFallbackSurface } from "./reference-frame/fallback-surface";
import { ReferenceFrameRenderer } from "./reference-frame/renderer";
import { REFERENCE_ATTACHMENTS, attachmentInfo, type ReferenceView } from "./reference-frame/types";

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
  resize(width: number, height: number): void;
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

  const updateEvidence = () => {
    const info = attachmentInfo(selected);
    context.setStatus(
      `${info.label} · ${info.format} · ${info.range} · last writer: ${info.lastWriter}`,
      "success",
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
      context.setMetrics({ backend: "Canvas fallback", status: "STATIC ATTACHMENT ATLAS" });
      context.setStatus(`${reason} Showing deterministic attachment atlas.`, "warning");
    } catch (error) {
      fallback?.dispose();
      const fallbackError = error instanceof Error ? error.message : "Canvas fallback unavailable.";
      context.setStatus(`${reason} ${fallbackError}`, "error");
    }
  };

  const setup = async () => {
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
      context.setStatus(
        "Live WebGPU attachments share one reference frame; select a buffer or freeze the frame.",
        "success",
      );
      context.setMetrics({ backend: renderer.backendLabel, status: "LIVE ATTACHMENTS" });
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
      context.controls.append(...viewButtons, freezeButton);
      await setup();
      updateEvidence();
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

class CanvasInspectorFallback implements InspectorRenderer {
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
