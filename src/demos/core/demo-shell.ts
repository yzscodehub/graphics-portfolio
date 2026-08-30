import { getCapabilities, shouldUseStaticFallback } from "./capabilities";
import { demoRegistry } from "./registry";
import type { DemoController, DemoMetrics, DemoQuality } from "./types";

const ACTIVE_SHELLS = new WeakMap<HTMLElement, MountedDemo>();

interface MountedDemo {
  dispose(): Promise<void>;
}

type ShellState = "loading" | "running" | "fallback" | "error";

interface ShellCopy {
  states: Record<ShellState, string>;
  unknownModule: string;
  incompleteMarkup: string;
  loading: string;
  reducedMotionFallback: string;
  coarsePointerFallback: string;
  localFallback: string;
}

const shellCopy: Record<"en" | "zh-CN", ShellCopy> = {
  en: {
    states: {
      loading: "INITIALIZING",
      running: "LIVE / RUNNING",
      fallback: "STATIC PREVIEW",
      error: "UNAVAILABLE",
    },
    unknownModule: "Unknown demo module.",
    incompleteMarkup: "Demo markup is incomplete.",
    loading: "Loading local render module…",
    reducedMotionFallback: "Reduced motion: static preview enabled.",
    coarsePointerFallback: "Touch device: static preview enabled.",
    localFallback: "Showing local static preview.",
  },
  "zh-CN": {
    states: {
      loading: "初始化中",
      running: "运行中",
      fallback: "静态预览",
      error: "不可用",
    },
    unknownModule: "未知的 Demo 模块。",
    incompleteMarkup: "Demo 结构不完整。",
    loading: "正在加载本地渲染模块…",
    reducedMotionFallback: "减少动态效果：已显示静态预览。",
    coarsePointerFallback: "触摸设备：已显示静态预览。",
    localFallback: "已显示本地静态预览。",
  },
};

function copyFor(shell: HTMLElement): ShellCopy {
  return shellCopy[shell.dataset.demoLocale === "zh-CN" ? "zh-CN" : "en"];
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

function setShellState(shell: HTMLElement, state: ShellState): void {
  shell.dataset.demoState = state;
  const stateElement = shell.querySelector<HTMLElement>("[data-demo-state]");
  if (!stateElement) return;
  stateElement.dataset.state = state;
  stateElement.textContent = copyFor(shell).states[state];
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
    setStatus(shell, copyFor(shell).unknownModule, "error");
    return;
  }

  const forceLive = shell.dataset.forceLive === "true";
  const quality = (shell.dataset.quality || "auto") as DemoQuality;
  const capabilities = getCapabilities();
  if (shouldUseStaticFallback(forceLive, capabilities)) {
    staticFallback(
      shell,
      capabilities.reducedMotion
        ? copyFor(shell).reducedMotionFallback
        : copyFor(shell).coarsePointerFallback,
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
    setStatus(shell, copyFor(shell).incompleteMarkup, "error");
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
    setStatus(shell, copyFor(shell).loading);
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
        staticFallback(shell, `${message} ${copyFor(shell).localFallback}`);
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
