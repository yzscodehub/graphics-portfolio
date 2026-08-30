import { clearElement, drawStageBackdrop, makeButton, resizeCanvas } from "./core/canvas";
import type { DemoContext, DemoController } from "./core/types";

interface PassNode {
  id: string;
  label: string;
  reads: string[];
  writes: string[];
  x: number;
  y: number;
  enabled: boolean;
}

const PASSES: PassNode[] = [
  {
    id: "depth",
    label: "DEPTH PREPASS",
    reads: [],
    writes: ["Depth"],
    x: 0.09,
    y: 0.2,
    enabled: true,
  },
  {
    id: "gbuffer",
    label: "G-BUFFER",
    reads: ["Depth"],
    writes: ["Normal", "Albedo", "Velocity"],
    x: 0.34,
    y: 0.18,
    enabled: true,
  },
  {
    id: "lighting",
    label: "LIGHTING",
    reads: ["Depth", "Normal", "Albedo"],
    writes: ["HDR"],
    x: 0.61,
    y: 0.2,
    enabled: true,
  },
  {
    id: "taa",
    label: "TEMPORAL AA",
    reads: ["HDR", "Velocity"],
    writes: ["History"],
    x: 0.46,
    y: 0.67,
    enabled: true,
  },
  {
    id: "tone",
    label: "TONE MAP",
    reads: ["History"],
    writes: ["Present"],
    x: 0.78,
    y: 0.66,
    enabled: true,
  },
];

export function createDemo(): DemoController {
  let context: DemoContext;
  let ctx: CanvasRenderingContext2D;
  let width = 1;
  let height = 1;
  let selected = PASSES[1].id;
  let running = false;

  const draw = () => {
    drawStageBackdrop(ctx, width, height);
    const live = PASSES.filter((pass) => pass.enabled);
    const resourceOwners = new Map<string, PassNode>();
    live.forEach((pass) => pass.writes.forEach((resource) => resourceOwners.set(resource, pass)));
    live.forEach((pass) => {
      pass.reads.forEach((resource) => {
        const owner = resourceOwners.get(resource);
        if (!owner) return;
        drawLink(owner, pass);
      });
    });
    live.forEach(drawNode);
    ctx.fillStyle = "rgba(232,230,220,.68)";
    ctx.font = "12px ui-monospace, monospace";
    const selectedPass = PASSES.find((pass) => pass.id === selected)!;
    const status = `${selectedPass.label}: reads [${selectedPass.reads.join(", ") || "scene"}] → writes [${selectedPass.writes.join(", ")}]`;
    ctx.fillText(status, 16, height - 18);
  };

  const drawNode = (pass: PassNode) => {
    const x = pass.x * width;
    const y = pass.y * height;
    const w = Math.min(160, width * 0.22);
    const h = 58;
    const isSelected = pass.id === selected;
    ctx.fillStyle = isSelected ? "#57e3c2" : "#102321";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = isSelected ? "#e8e6dc" : "rgba(87,227,194,.45)";
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = isSelected ? "#071011" : "#e8e6dc";
    ctx.font = "bold 11px ui-monospace, monospace";
    ctx.fillText(pass.label, x + 9, y + 22);
    ctx.fillStyle = isSelected ? "rgba(7,16,17,.72)" : "rgba(232,230,220,.55)";
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillText(`R${pass.reads.length} / W${pass.writes.length}`, x + 9, y + 43);
  };

  const drawLink = (from: PassNode, to: PassNode) => {
    const nodeWidth = Math.min(160, width * 0.22);
    const fromX = from.x * width + nodeWidth;
    const fromY = from.y * height + 29;
    const toX = to.x * width;
    const toY = to.y * height + 29;
    ctx.strokeStyle =
      from.id === selected || to.id === selected ? "#f0b84b" : "rgba(137,183,175,.54)";
    ctx.lineWidth = from.id === selected || to.id === selected ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.bezierCurveTo(fromX + 32, fromY, toX - 32, toY, toX, toY);
    ctx.stroke();
  };

  const inspect = (pass: PassNode) => {
    selected = pass.id;
    context.setMetrics({
      backend: "Canvas graph inspector",
      status: `${pass.reads.length} reads / ${pass.writes.length} writes`,
    });
    context.setStatus(
      `${pass.label}: resource lifetime is visualized from first write to final read.`,
      "success",
    );
    draw();
  };

  return {
    async init(next) {
      context = next;
      PASSES.forEach((pass) => {
        pass.enabled = true;
      });
      selected = "gbuffer";
      ctx = resizeCanvas(context.canvas, width, height);
      clearElement(context.controls);
      PASSES.forEach((pass) => {
        const button = makeButton(pass.label.replace(" ", "\n"), pass.id === selected);
        button.addEventListener(
          "click",
          () => {
            PASSES.forEach((candidate) => {
              if (candidate.id === pass.id) candidate.enabled = !candidate.enabled;
            });
            if (!pass.enabled && selected === pass.id)
              selected = PASSES.find((candidate) => candidate.enabled)?.id ?? "depth";
            button.setAttribute("aria-pressed", String(pass.enabled));
            context.setStatus(
              `${pass.label} ${pass.enabled ? "enabled" : "culled"}; dependencies recomputed.`,
              pass.enabled ? "success" : "warning",
            );
            draw();
          },
          { signal: context.signal },
        );
        context.controls.append(button);
      });
      context.canvas.addEventListener(
        "click",
        (event) => {
          const rect = context.canvas.getBoundingClientRect();
          const x = event.clientX - rect.left;
          const y = event.clientY - rect.top;
          const nodeWidth = Math.min(160, width * 0.22);
          const hit = PASSES.find(
            (pass) =>
              pass.enabled &&
              x >= pass.x * width &&
              x <= pass.x * width + nodeWidth &&
              y >= pass.y * height &&
              y <= pass.y * height + 58,
          );
          if (hit) inspect(hit);
        },
        { signal: context.signal },
      );
      inspect(PASSES[1]);
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
