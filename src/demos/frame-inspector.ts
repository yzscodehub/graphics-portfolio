import { clearElement, drawStageBackdrop, makeButton, resizeCanvas } from "./core/canvas";
import type { DemoContext, DemoController } from "./core/types";

export type BufferView = "final" | "normal" | "depth" | "velocity" | "lighting" | "ssao";

export const BUFFER_VIEWS: readonly BufferView[] = [
  "final",
  "normal",
  "depth",
  "velocity",
  "lighting",
  "ssao",
];

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

  const columns = width < NARROW_LAYOUT_BREAKPOINT ? 2 : 3;
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
): BufferView | undefined {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  const column = Math.floor((x - layout.gap) / (layout.cellWidth + layout.gap));
  const row = Math.floor((y - layout.gap) / (layout.cellHeight + layout.gap));
  if (column < 0 || column >= layout.columns || row < 0 || row >= layout.rows) return undefined;

  const cellX = layout.gap + column * (layout.cellWidth + layout.gap);
  const cellY = layout.gap + row * (layout.cellHeight + layout.gap);
  if (x > cellX + layout.cellWidth || y > cellY + layout.cellHeight) return undefined;

  return BUFFER_VIEWS[row * layout.columns + column];
}

export function createDemo(): DemoController {
  let context: DemoContext;
  let ctx: CanvasRenderingContext2D;
  let width = 1;
  let height = 1;
  let active: BufferView = "final";
  let running = false;
  const draw = () => {
    drawStageBackdrop(ctx, width, height);
    const layout = calculateFrameInspectorLayout(width, height);
    if (!layout) return;

    BUFFER_VIEWS.forEach((view, index) => {
      const x = layout.gap + (index % layout.columns) * (layout.cellWidth + layout.gap);
      const y = layout.gap + Math.floor(index / layout.columns) * (layout.cellHeight + layout.gap);
      drawBuffer(ctx, view, x, y, layout.cellWidth, layout.cellHeight, view === active);
    });
    const activeIndex = BUFFER_VIEWS.indexOf(active);
    const x = layout.gap + (activeIndex % layout.columns) * (layout.cellWidth + layout.gap);
    const y =
      layout.gap + Math.floor(activeIndex / layout.columns) * (layout.cellHeight + layout.gap);
    ctx.strokeStyle = "#f0b84b";
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 1, y - 1, layout.cellWidth + 2, layout.cellHeight + 2);
    ctx.fillStyle = "rgba(232,230,220,.72)";
    ctx.font = "11px ui-monospace, monospace";
    ctx.fillText(`ACTIVE ATTACHMENT: ${active.toUpperCase()}`, 16, height - 13);
  };
  const select = (view: BufferView) => {
    active = view;
    context.setMetrics({ backend: "Canvas buffer inspector", status: view.toUpperCase() });
    context.setStatus(
      `${view.toUpperCase()} attachment selected. This preview uses a procedural scene, not captured production data.`,
      "success",
    );
    draw();
  };
  return {
    async init(next) {
      context = next;
      ctx = resizeCanvas(context.canvas, width, height);
      clearElement(context.controls);
      BUFFER_VIEWS.forEach((view) => {
        const button = makeButton(view.toUpperCase(), view === active);
        button.addEventListener(
          "click",
          () => {
            select(view);
            context.controls
              .querySelectorAll("button")
              .forEach((entry) => entry.setAttribute("aria-pressed", String(entry === button)));
          },
          { signal: context.signal },
        );
        context.controls.append(button);
      });
      context.canvas.addEventListener(
        "click",
        (event) => {
          const rect = context.canvas.getBoundingClientRect();
          const layout = calculateFrameInspectorLayout(width, height);
          const view =
            layout &&
            bufferViewAtPoint(layout, event.clientX - rect.left, event.clientY - rect.top);
          if (view) select(view);
        },
        { signal: context.signal },
      );
      select(active);
    },
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      ctx = resizeCanvas(context.canvas, width, height);
      if (running) draw();
    },
    pause() {
      running = false;
    },
    resume() {
      running = true;
      draw();
    },
    dispose() {
      running = false;
    },
  };
}

function drawBuffer(
  ctx: CanvasRenderingContext2D,
  view: BufferView,
  x: number,
  y: number,
  width: number,
  height: number,
  selected: boolean,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
  const centerX = x + width * 0.5;
  const centerY = y + height * 0.56;
  const radius = Math.min(width, height) * 0.25;
  if (view === "final") {
    const bg = ctx.createLinearGradient(x, y, x + width, y + height);
    bg.addColorStop(0, "#17312e");
    bg.addColorStop(1, "#271e16");
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, width, height);
    drawSphere(ctx, centerX, centerY, radius, "#57e3c2");
  } else if (view === "normal") {
    const gradient = ctx.createRadialGradient(
      centerX - radius * 0.4,
      centerY - radius * 0.4,
      1,
      centerX,
      centerY,
      radius,
    );
    gradient.addColorStop(0, "#b7a8f1");
    gradient.addColorStop(0.45, "#75c8ab");
    gradient.addColorStop(1, "#2853af");
    ctx.fillStyle = "#10172b";
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fill();
  } else if (view === "depth") {
    const gradient = ctx.createLinearGradient(x, y, x, y + height);
    gradient.addColorStop(0, "#f4f0da");
    gradient.addColorStop(1, "#152221");
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = "#263b39";
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fill();
  } else if (view === "velocity") {
    ctx.fillStyle = "#11131c";
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = "#f0b84b";
    ctx.lineWidth = 2;
    for (let row = 0; row < 5; row += 1)
      for (let col = 0; col < 8; col += 1) {
        const ax = x + 15 + (col * (width - 30)) / 7;
        const ay = y + 16 + (row * (height - 32)) / 4;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax + 7 + row * 2, ay - 2 + (col % 3) * 3);
        ctx.stroke();
      }
  } else if (view === "lighting") {
    ctx.fillStyle = "#1d1710";
    ctx.fillRect(x, y, width, height);
    const bloom = ctx.createRadialGradient(
      centerX,
      centerY - radius * 0.4,
      1,
      centerX,
      centerY - radius * 0.4,
      radius * 2.1,
    );
    bloom.addColorStop(0, "#fff1ad");
    bloom.addColorStop(0.2, "#f0b84b");
    bloom.addColorStop(1, "rgba(240,184,75,0)");
    ctx.fillStyle = bloom;
    ctx.fillRect(x, y, width, height);
    drawSphere(ctx, centerX, centerY, radius, "#975f1f");
  } else {
    ctx.fillStyle = "#e0ded1";
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = "#4b5550";
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 1.24, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#aeb6ad";
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = selected ? "#57e3c2" : "rgba(232,230,220,.23)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, width, height);
  ctx.fillStyle = selected ? "#57e3c2" : "rgba(232,230,220,.72)";
  ctx.font = "10px ui-monospace, monospace";
  ctx.fillText(view.toUpperCase(), x + 8, y + 16);
}
function drawSphere(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
): void {
  const gradient = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.4, 1, x, y, radius);
  gradient.addColorStop(0, "#f5f3e8");
  gradient.addColorStop(0.45, color);
  gradient.addColorStop(1, "#08201d");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}
