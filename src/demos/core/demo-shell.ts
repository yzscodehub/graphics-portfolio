import { getCapabilities, shouldUseStaticFallback } from "./capabilities";
import { demoRegistry } from "./registry";
import type { DemoController, DemoMetrics, DemoQuality } from "./types";

const ACTIVE_SHELLS = new WeakMap<HTMLElement, MountedDemo>();

interface MountedDemo {
  dispose(): Promise<void>;
}

function metricText(metrics: DemoMetrics): string {
  const values = [
    metrics.backend,
    metrics.status,
    metrics.fps === undefined ? undefined : `${metrics.fps} FPS`,
    metrics.frameTimeMs === undefined ? undefined : `${metrics.frameTimeMs} ms`,
    metrics.inferenceMs === undefined
      ? undefined
      : `${metrics.inferenceMs.toFixed(2)} ms inference`,
    metrics.samples === undefined ? undefined : `${metrics.samples} spp`,
  ].filter(Boolean);
  return values.join(" · ");
}

function setShellState(
  shell: HTMLElement,
  state: "loading" | "running" | "fallback" | "error",
): void {
  shell.dataset.demoState = state;
  shell.querySelector<HTMLElement>("[data-demo-state]")?.setAttribute("data-state", state);
}

function setStatus(
  shell: HTMLElement,
  message: string,
  tone: "info" | "success" | "warning" | "error" = "info",
): void {
  const status = shell.querySelector<HTMLElement>("[data-demo-status]");
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
}

function staticFallback(shell: HTMLElement, message: string): void {
  const canvas = shell.querySelector<HTMLCanvasElement>("canvas");
  const fallback = shell.querySelector<HTMLElement>("[data-demo-fallback]");
  if (canvas) canvas.hidden = true;
  if (fallback) fallback.hidden = false;
  setShellState(shell, "fallback");
  setStatus(shell, message, "warning");
}

export function mountDemoShell(shell: HTMLElement): void {
  if (ACTIVE_SHELLS.has(shell)) return;
  const slug = shell.dataset.demoSlug;
  const item = slug ? demoRegistry[slug] : undefined;
  if (!item) {
    setShellState(shell, "error");
    setStatus(shell, "Unknown demo module.", "error");
    return;
  }

  const forceLive = shell.dataset.forceLive === "true";
  const quality = (shell.dataset.quality || "auto") as DemoQuality;
  const capabilities = getCapabilities();
  if (shouldUseStaticFallback(forceLive, capabilities)) {
    staticFallback(
      shell,
      capabilities.reducedMotion
        ? "Reduced motion: static preview enabled."
        : "Touch device: static preview enabled.",
    );
    return;
  }

  let controller: DemoController | undefined;
  let destroyed = false;
  let inViewport = false;
  let started = false;
  let documentVisible = !document.hidden;
  const abortController = new AbortController();
  const cleanup: Array<() => void> = [];
  const canvas = shell.querySelector<HTMLCanvasElement>("canvas");
  const stage = shell.querySelector<HTMLElement>("[data-demo-stage]");
  const controls = shell.querySelector<HTMLElement>("[data-demo-controls]");
  const metrics = shell.querySelector<HTMLElement>("[data-demo-metrics]");

  if (!canvas || !stage || !controls || !metrics) {
    setShellState(shell, "error");
    setStatus(shell, "Demo markup is incomplete.", "error");
    return;
  }

  const resize = () => {
    if (!controller) return;
    const bounds = stage.getBoundingClientRect();
    controller.resize(
      Math.max(1, Math.floor(bounds.width)),
      Math.max(220, Math.floor(bounds.height)),
    );
  };
  const updateState = () => {
    if (!controller || destroyed) return;
    if (inViewport && documentVisible) controller.resume();
    else controller.pause();
  };

  const start = () => {
    if (started || destroyed) return;
    started = true;
    setShellState(shell, "loading");
    setStatus(shell, "Loading local render module…");
    void item
      .load()
      .then(async ({ createDemo }) => {
        if (destroyed) return;
        controller = createDemo();
        await controller.init({
          canvas,
          stage,
          controls,
          metrics,
          signal: abortController.signal,
          quality,
          setMetrics: (next) => {
            metrics.textContent = metricText(next);
          },
          setStatus: (message, tone) => setStatus(shell, message, tone),
          addCleanup: (fn) => cleanup.push(fn),
        });
        if (destroyed) return;
        resize();
        setShellState(shell, "running");
        updateState();
      })
      .catch((error: unknown) => {
        if (destroyed) return;
        const message = error instanceof Error ? error.message : "Demo failed to initialize.";
        staticFallback(shell, `${message} Showing local fallback.`);
      });
  };

  const observer = new IntersectionObserver(
    (entries) => {
      inViewport = entries.some((entry) => entry.isIntersecting);
      if (inViewport) start();
      updateState();
    },
    { rootMargin: "160px 0px" },
  );
  observer.observe(shell);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);
  const onVisibilityChange = () => {
    documentVisible = !document.hidden;
    updateState();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  const dispose = async () => {
    if (destroyed) return;
    destroyed = true;
    abortController.abort();
    observer.disconnect();
    resizeObserver.disconnect();
    document.removeEventListener("visibilitychange", onVisibilityChange);
    cleanup
      .splice(0)
      .reverse()
      .forEach((fn) => fn());
    await controller?.dispose();
    ACTIVE_SHELLS.delete(shell);
  };
  ACTIVE_SHELLS.set(shell, { dispose });
}

export function unmountDemoShell(shell: HTMLElement): Promise<void> {
  return ACTIVE_SHELLS.get(shell)?.dispose() ?? Promise.resolve();
}

export function mountAllDemoShells(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-demo-shell]").forEach(mountDemoShell);
}
