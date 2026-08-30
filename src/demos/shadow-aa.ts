import {
  clearElement,
  createMetricReporter,
  drawStageBackdrop,
  makeButton,
  resizeCanvas,
} from "./core/canvas";
import type { DemoContext, DemoController } from "./core/types";

type ShadowMode = "hard" | "pcf" | "pcss";
type AaMode = "none" | "fxaa" | "taa";

export function createDemo(): DemoController {
  let context: DemoContext;
  let ctx: CanvasRenderingContext2D;
  let width = 1;
  let height = 1;
  let raf = 0;
  let running = false;
  let shadow: ShadowMode = "pcf";
  let aa: AaMode = "fxaa";
  let previousOffset = 0;
  let report: ReturnType<typeof createMetricReporter>;

  const draw = (time: number) => {
    if (!running) return;
    drawStageBackdrop(ctx, width, height);
    const pulse = Math.sin(time * 0.001) * 7;
    const x = width * 0.47 + pulse;
    const y = height * 0.45;
    const radius = Math.min(width, height) * 0.16;
    ctx.fillStyle = "#172a29";
    ctx.fillRect(0, height * 0.68, width, height * 0.32);
    const shadowX = x + radius * 0.8;
    const shadowY = height * 0.7;
    const blur = shadow === "hard" ? 0 : shadow === "pcf" ? 9 : 22;
    ctx.save();
    ctx.filter = blur ? `blur(${blur}px)` : "none";
    ctx.fillStyle = "rgba(0,0,0,.65)";
    ctx.beginPath();
    ctx.ellipse(shadowX, shadowY, radius * 1.05, radius * 0.25, -0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (aa === "taa") {
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = "#f0b84b";
      ctx.beginPath();
      ctx.arc(x + previousOffset, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      previousOffset = pulse;
    }
    const gradient = ctx.createRadialGradient(
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
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = aa === "none" ? "#f0b84b" : "rgba(232,230,220,.7)";
    ctx.lineWidth = aa === "none" ? 2 : 1;
    ctx.stroke();
    ctx.fillStyle = "#e8e6dc";
    ctx.font = "12px ui-monospace, monospace";
    ctx.fillText(`SHADOW ${shadow.toUpperCase()} / AA ${aa.toUpperCase()}`, 16, 24);
    ctx.fillStyle = "rgba(232,230,220,.62)";
    ctx.fillText(
      "Parameters affect the drawn filter, edge treatment, and history trail.",
      16,
      height - 16,
    );
    report({
      backend: "Canvas comparison",
      status: `${shadow.toUpperCase()} / ${aa.toUpperCase()}`,
    });
    raf = requestAnimationFrame(draw);
  };
  const drawOnce = () => {
    if (!running) return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(draw);
  };

  return {
    async init(next) {
      context = next;
      ctx = resizeCanvas(context.canvas, width, height);
      report = createMetricReporter(context);
      clearElement(context.controls);
      const shadowButtons = (["hard", "pcf", "pcss"] as ShadowMode[]).map((mode) =>
        makeButton(`SHADOW ${mode.toUpperCase()}`, mode === shadow),
      );
      const aaButtons = (["none", "fxaa", "taa"] as AaMode[]).map((mode) =>
        makeButton(`AA ${mode.toUpperCase()}`, mode === aa),
      );
      context.controls.append(...shadowButtons, ...aaButtons);
      shadowButtons.forEach((button, index) =>
        button.addEventListener(
          "click",
          () => {
            shadow = (["hard", "pcf", "pcss"] as ShadowMode[])[index];
            shadowButtons.forEach((entry) =>
              entry.setAttribute("aria-pressed", String(entry === button)),
            );
            context.setStatus(`Shadow mode set to ${shadow.toUpperCase()}.`, "success");
            drawOnce();
          },
          { signal: context.signal },
        ),
      );
      aaButtons.forEach((button, index) =>
        button.addEventListener(
          "click",
          () => {
            aa = (["none", "fxaa", "taa"] as AaMode[])[index];
            aaButtons.forEach((entry) =>
              entry.setAttribute("aria-pressed", String(entry === button)),
            );
            context.setStatus(`Anti-aliasing mode set to ${aa.toUpperCase()}.`, "success");
            drawOnce();
          },
          { signal: context.signal },
        ),
      );
      context.setStatus("Interactive shadow softness and edge-treatment comparison.", "success");
    },
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      ctx = resizeCanvas(context.canvas, width, height);
    },
    pause() {
      running = false;
      cancelAnimationFrame(raf);
    },
    resume() {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(draw);
    },
    dispose() {
      cancelAnimationFrame(raf);
    },
  };
}
