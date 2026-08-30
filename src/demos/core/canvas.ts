import type { DemoContext, DemoMetrics } from "./types";

export function resizeCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  maxDpr = 1.5,
): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable.");
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  canvas.width = Math.max(1, Math.floor(width * dpr));
  canvas.height = Math.max(1, Math.floor(height * dpr));
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  return context;
}

export function createMetricReporter(context: DemoContext): (metrics: DemoMetrics) => void {
  let frames = 0;
  let lastTime = performance.now();
  return (metrics) => {
    frames += 1;
    const now = performance.now();
    if (now - lastTime < 400) return;
    const elapsed = now - lastTime;
    const fps = Math.round((frames * 1000) / elapsed);
    context.setMetrics({
      ...metrics,
      fps,
      frameTimeMs: Number((elapsed / frames).toFixed(1)),
      metricSource: metrics.metricSource ?? "animation-frame",
    });
    frames = 0;
    lastTime = now;
  };
}

export function makeButton(label: string, pressed = false): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "demo-control";
  button.textContent = label;
  button.setAttribute("aria-pressed", String(pressed));
  return button;
}

export function makeRange(
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
): HTMLInputElement {
  const wrapper = document.createElement("label");
  wrapper.className = "demo-range";
  wrapper.textContent = label;
  const range = document.createElement("input");
  range.type = "range";
  range.min = String(min);
  range.max = String(max);
  range.step = String(step);
  range.value = String(value);
  range.setAttribute("aria-label", label);
  wrapper.append(range);
  return range;
}

export function clearElement(element: HTMLElement): void {
  element.replaceChildren();
}

export function drawStageBackdrop(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#071011");
  gradient.addColorStop(0.55, "#0e1c1b");
  gradient.addColorStop(1, "#11120d");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "rgba(137, 183, 175, 0.12)";
  context.lineWidth = 1;
  const step = 32;
  for (let x = 0; x < width; x += step) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  for (let y = 0; y < height; y += step) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
}
