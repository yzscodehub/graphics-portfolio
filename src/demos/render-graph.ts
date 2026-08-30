import { clearElement, makeButton } from "./core/canvas";
import { Measurement } from "./core/runtime";
import type { DemoContext, DemoController } from "./core/types";
import {
  compileRenderGraph,
  type CompiledPass,
  type RenderGraphCompileResult,
  type RenderGraphPlan,
} from "./render-graph/core";
import { createRenderGraphDefinition, renderGraphPasses } from "./render-graph/demo-definition";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

interface NodePosition {
  x: number;
  y: number;
}

export function createDemo(): DemoController {
  let context: DemoContext;
  let root: HTMLDivElement;
  let svg: SVGSVGElement;
  let inspector: HTMLDivElement;
  let selected = "gbuffer";
  let result: RenderGraphCompileResult | undefined;
  const enabled = new Set(renderGraphPasses.map((pass) => pass.id));
  const measurement = new Measurement("cpu-wall-clock");

  const render = (announce = true) => {
    const started = measurement.start();
    result = compileRenderGraph(createRenderGraphDefinition(enabled));
    const compileMs = Number(measurement.elapsed(started).toFixed(2));
    renderSvg(svg, result, selected, select);
    renderInspector(inspector, result, selected);
    const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
    const plan = result.plan;
    context.setMetrics(
      measurement.withSource({
        backend: "RenderGraphCore / SVG inspector",
        compileMs,
        status: plan
          ? `${plan.passes.length} live / ${plan.culledPassIds.length} culled`
          : `${errors.length} validation error${errors.length === 1 ? "" : "s"}`,
      }),
    );
    if (!announce) return;
    if (errors.length) {
      context.setStatus(errors[0].message, "error");
      return;
    }
    if (!plan) {
      context.setStatus("No Present or side-effect pass anchors this graph.", "warning");
      return;
    }
    context.setStatus(
      `Compiled ${plan.passes.length} live passes, ${plan.culledPassIds.length} culled passes, and ${plan.aliasSlots.length} transient allocation slots.`,
      "success",
    );
  };

  const select = (passId: string) => {
    selected = passId;
    render(false);
  };

  return {
    async init(next) {
      context = next;
      context.canvas.hidden = true;
      root = document.createElement("div");
      root.setAttribute("aria-label", "Compiled render graph inspector");
      root.setAttribute("role", "region");
      root.style.cssText =
        "position:absolute;inset:0;display:grid;grid-template-rows:minmax(220px,1fr) auto;overflow:auto;background:#071011;color:#e8e6dc;font:12px ui-monospace,monospace;";
      svg = document.createElementNS(SVG_NAMESPACE, "svg");
      svg.setAttribute(
        "aria-label",
        "Render graph execution plan. Use Tab then Enter or Space to inspect a pass.",
      );
      svg.setAttribute("role", "group");
      svg.setAttribute("viewBox", "0 0 1000 420");
      svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
      svg.style.cssText = "min-height:220px;width:100%;background:#071011;";
      inspector = document.createElement("div");
      inspector.setAttribute("aria-live", "polite");
      inspector.style.cssText =
        "border-top:1px solid #31433f;padding:12px 16px;color:#c4d0cc;line-height:1.55;";
      root.append(svg, inspector);
      context.stage.append(root);
      context.addCleanup(() => root.remove());

      clearElement(context.controls);
      renderGraphPasses.forEach((pass) => {
        const button = makeButton(pass.label, enabled.has(pass.id));
        const toggle = () => {
          if (enabled.has(pass.id)) enabled.delete(pass.id);
          else enabled.add(pass.id);
          button.setAttribute("aria-pressed", String(enabled.has(pass.id)));
          if (selected === pass.id && !enabled.has(pass.id)) selected = "tone";
          render();
        };
        listen(context, button, "click", toggle);
        context.controls.append(button);
      });
      render();
    },
    resize() {
      render(false);
    },
    pause() {},
    resume() {
      render(false);
    },
    dispose() {
      context.canvas.hidden = false;
    },
  };
}

function listen(
  context: DemoContext,
  target: EventTarget,
  type: string,
  listener: EventListenerOrEventListenerObject,
): void {
  if (context.resources) context.resources.on(target, type, listener);
  else target.addEventListener(type, listener, { signal: context.signal });
}

function renderSvg(
  svg: SVGSVGElement,
  result: RenderGraphCompileResult,
  selected: string,
  select: (passId: string) => void,
): void {
  svg.replaceChildren();
  const plan = result.plan;
  if (!plan) {
    const title = addSvgText(svg, 40, 54, "GRAPH VALIDATION FAILED", "#f0b84b", 18, "bold");
    title.setAttribute("aria-hidden", "true");
    result.diagnostics.forEach((diagnostic, index) =>
      addSvgText(svg, 40, 94 + index * 28, diagnostic.message, "#e8e6dc", 13),
    );
    return;
  }

  const positions = new Map<string, NodePosition>();
  plan.passes.forEach((pass, index) => {
    positions.set(pass.id, { x: 48 + index * (896 / Math.max(1, plan.passes.length - 1)), y: 126 });
  });
  plan.culledPassIds.forEach((passId, index) => {
    positions.set(passId, { x: 48 + index * 170, y: 310 });
  });
  plan.passes.forEach((pass) => drawDependencies(svg, pass, positions));
  plan.culledPassIds.forEach((passId) =>
    drawCulledNode(svg, passId, positions.get(passId)!, selected, select),
  );
  plan.passes.forEach((pass, index) =>
    drawPassNode(svg, pass, index, positions.get(pass.id)!, selected, select),
  );
  addSvgText(
    svg,
    24,
    30,
    `COMPILED SCHEDULE · ${plan.passes.length} LIVE · ${plan.culledPassIds.length} CULLED · ${plan.aliasSlots.length} TRANSIENT SLOTS`,
    "#57e3c2",
    12,
    "bold",
  );
  if (plan.culledPassIds.length)
    addSvgText(svg, 24, 276, "CULLED: NOT REACHABLE FROM PRESENT OR A SIDE EFFECT", "#899995", 11);
}

function drawDependencies(
  svg: SVGSVGElement,
  pass: CompiledPass,
  positions: Map<string, NodePosition>,
): void {
  const to = positions.get(pass.id);
  if (!to) return;
  pass.dependencies.forEach((dependency) => {
    const from = positions.get(dependency);
    if (!from) return;
    const line = document.createElementNS(SVG_NAMESPACE, "path");
    line.setAttribute(
      "d",
      `M ${from.x + 66} ${from.y} C ${from.x + 100} ${from.y}, ${to.x - 100} ${to.y}, ${to.x - 66} ${to.y}`,
    );
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "#55706a");
    line.setAttribute("stroke-width", "1.5");
    line.setAttribute("marker-end", "url(#rg-arrow)");
    svg.append(line);
  });
  if (!svg.querySelector("#rg-arrow")) {
    const defs = document.createElementNS(SVG_NAMESPACE, "defs");
    const marker = document.createElementNS(SVG_NAMESPACE, "marker");
    marker.setAttribute("id", "rg-arrow");
    marker.setAttribute("markerHeight", "5");
    marker.setAttribute("markerWidth", "5");
    marker.setAttribute("orient", "auto");
    marker.setAttribute("refX", "4");
    marker.setAttribute("refY", "2.5");
    const arrow = document.createElementNS(SVG_NAMESPACE, "path");
    arrow.setAttribute("d", "M 0 0 L 5 2.5 L 0 5 Z");
    arrow.setAttribute("fill", "#55706a");
    marker.append(arrow);
    defs.append(marker);
    svg.prepend(defs);
  }
}

function drawPassNode(
  svg: SVGSVGElement,
  pass: CompiledPass,
  index: number,
  position: NodePosition,
  selected: string,
  select: (passId: string) => void,
): void {
  const node = createInteractiveNode(
    pass.id,
    `${pass.label}, compiled order ${index + 1}`,
    selected,
    select,
  );
  const rect = document.createElementNS(SVG_NAMESPACE, "rect");
  rect.setAttribute("x", String(position.x - 66));
  rect.setAttribute("y", String(position.y - 34));
  rect.setAttribute("width", "132");
  rect.setAttribute("height", "68");
  rect.setAttribute("rx", "2");
  rect.setAttribute("fill", selected === pass.id ? "#57e3c2" : "#102321");
  rect.setAttribute("stroke", selected === pass.id ? "#e8e6dc" : "#3e8074");
  node.append(rect);
  addSvgText(
    node,
    position.x - 55,
    position.y - 5,
    pass.label,
    selected === pass.id ? "#071011" : "#e8e6dc",
    11,
    "bold",
  );
  addSvgText(
    node,
    position.x - 55,
    position.y + 17,
    `#${index + 1} · R${pass.reads.length} W${pass.writes.length}`,
    selected === pass.id ? "#183b35" : "#aabbb5",
    10,
  );
  svg.append(node);
}

function drawCulledNode(
  svg: SVGSVGElement,
  passId: string,
  position: NodePosition,
  selected: string,
  select: (passId: string) => void,
): void {
  const node = createInteractiveNode(
    passId,
    `${passId}, culled from the compiled schedule`,
    selected,
    select,
  );
  const rect = document.createElementNS(SVG_NAMESPACE, "rect");
  rect.setAttribute("x", String(position.x));
  rect.setAttribute("y", String(position.y - 22));
  rect.setAttribute("width", "150");
  rect.setAttribute("height", "44");
  rect.setAttribute("fill", "#152021");
  rect.setAttribute("stroke", selected === passId ? "#f0b84b" : "#59666a");
  rect.setAttribute("stroke-dasharray", "4 4");
  node.append(rect);
  addSvgText(node, position.x + 12, position.y + 4, passId.toUpperCase(), "#aeb8b4", 11, "bold");
  svg.append(node);
}

function createInteractiveNode(
  passId: string,
  label: string,
  selected: string,
  select: (passId: string) => void,
): SVGGElement {
  const node = document.createElementNS(SVG_NAMESPACE, "g");
  node.setAttribute("aria-label", label);
  node.setAttribute("aria-pressed", String(selected === passId));
  node.setAttribute("role", "button");
  node.setAttribute("tabindex", "0");
  node.style.cursor = "pointer";
  node.addEventListener("click", () => select(passId));
  node.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    select(passId);
  });
  return node;
}

function renderInspector(
  inspector: HTMLElement,
  result: RenderGraphCompileResult,
  selected: string,
): void {
  inspector.replaceChildren();
  const heading = document.createElement("strong");
  heading.textContent = `INSPECTOR / ${selected.toUpperCase()}`;
  inspector.append(heading);
  if (!result.plan) {
    const diagnostics = document.createElement("p");
    diagnostics.style.margin = "6px 0 0";
    diagnostics.textContent = result.diagnostics.map((diagnostic) => diagnostic.message).join(" ");
    inspector.append(diagnostics);
    return;
  }

  const details = document.createElement("p");
  details.style.margin = "6px 0 0";
  const selectedPass = result.plan.passes.find((pass) => pass.id === selected);
  if (!selectedPass) {
    details.textContent = `${selected.toUpperCase()} is enabled but culled because no Present or side-effect pass consumes it.`;
    inspector.append(details);
    return;
  }
  const versions = resourceVersionsForPass(result.plan, selectedPass);
  const transitions = result.plan.usageTransitions.filter(
    (transition) => transition.fromPass === selected || transition.toPass === selected,
  );
  details.textContent = [
    `Dependencies: ${selectedPass.dependencies.join(", ") || "none"}.`,
    `Resources: ${versions.map(describeVersion).join(" · ") || "none"}.`,
    `Usage transitions: ${transitions.map(describeTransition).join(" · ") || "none"}.`,
    "Transitions are backend planning metadata; WebGPU may satisfy compatible changes implicitly.",
  ].join(" ");
  inspector.append(details);
}

function resourceVersionsForPass(plan: RenderGraphPlan, pass: CompiledPass) {
  const ids = new Set([...pass.reads, ...pass.writes].map((access) => access.versionId));
  return plan.resourceVersions.filter((resource) => ids.has(resource.id));
}

function describeVersion(resource: RenderGraphPlan["resourceVersions"][number]): string {
  const slot =
    resource.aliasSlot === undefined ? "persistent/external" : `alias slot ${resource.aliasSlot}`;
  return `${resource.id} life P${resource.firstUse + 1}–P${resource.lastUse + 1}, ${slot}`;
}

function describeTransition(transition: RenderGraphPlan["usageTransitions"][number]): string {
  return `${transition.resourceVersion} ${transition.from} → ${transition.to}`;
}

function addSvgText(
  parent: SVGElement,
  x: number,
  y: number,
  content: string,
  fill: string,
  size: number,
  weight = "normal",
): SVGTextElement {
  const text = document.createElementNS(SVG_NAMESPACE, "text");
  text.setAttribute("x", String(x));
  text.setAttribute("y", String(y));
  text.setAttribute("fill", fill);
  text.setAttribute("font-size", String(size));
  text.setAttribute("font-weight", weight);
  text.textContent = content;
  parent.append(text);
  return text;
}
