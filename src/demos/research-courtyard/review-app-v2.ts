import { createResearchCourtyardGpuScene } from "./gpu-scene-v2";
import { ResearchCourtyardV2Loader } from "./loader-v2";
import {
  ResearchCourtyardReferenceRendererV2,
  type ResearchCourtyardDebugMode,
} from "./reference-renderer-v2";

interface CandidateManifest {
  status: "candidate";
  publishable: false;
  runtimeManifest: {
    uri: string;
    bytes: number;
    sha256: string;
  };
  counts: {
    meshes: number;
    materials: number;
    instances: number;
  };
  budgets: {
    courtyardGeometryBytes: number;
    ktx2Bytes: number;
    webpFallbackBytes: number;
    demoInitialKtx2Bytes: number;
  };
}

function element<T extends HTMLElement>(id: string) {
  const value = document.querySelector<T>(`#${id}`);
  if (!value) throw new Error(`Review element #${id} is missing.`);
  return value;
}

function candidateManifest(value: unknown): CandidateManifest {
  if (!value || typeof value !== "object") throw new Error("Candidate manifest is not an object.");
  const source = value as Partial<CandidateManifest>;
  if (
    source.status !== "candidate" ||
    source.publishable !== false ||
    !source.runtimeManifest ||
    typeof source.runtimeManifest.uri !== "string" ||
    !Number.isSafeInteger(source.runtimeManifest.bytes) ||
    !/^[a-f0-9]{64}$/.test(source.runtimeManifest.sha256) ||
    !source.counts ||
    !source.budgets
  )
    throw new Error("Candidate manifest identity is incomplete.");
  return source as CandidateManifest;
}

function mib(value: number) {
  return `${(value / (1024 * 1024)).toFixed(3)} MiB`;
}

async function start() {
  const canvas = element<HTMLCanvasElement>("courtyard-canvas");
  const state = element<HTMLElement>("review-state");
  const backend = element<HTMLElement>("review-backend");
  const inventory = element<HTMLElement>("review-inventory");
  const budget = element<HTMLElement>("review-budget");
  const lodControl = element<HTMLSelectElement>("review-lod");
  const debugControl = element<HTMLSelectElement>("review-debug");
  const exposureControl = element<HTMLInputElement>("review-exposure");
  const exposureValue = element<HTMLOutputElement>("review-exposure-value");
  const pauseButton = element<HTMLButtonElement>("review-pause");
  const abort = new AbortController();
  const basePath = `${import.meta.env.BASE_URL}assets/rendering/research-courtyard/`;
  const baseUrl = new URL(basePath, window.location.href).href;

  state.textContent = "VERIFYING CANDIDATE";
  state.dataset.state = "loading";
  const response = await fetch(new URL("candidate.manifest.json", baseUrl), {
    signal: abort.signal,
  });
  if (!response.ok) throw new Error(`Candidate manifest returned ${response.status}.`);
  const candidate = candidateManifest(await response.json());
  inventory.textContent =
    `${candidate.counts.meshes} MESHES / ` +
    `${candidate.counts.materials} MATERIALS / ` +
    `${candidate.counts.instances} DRAW INSTANCES`;
  budget.textContent =
    `GEOMETRY ${mib(candidate.budgets.courtyardGeometryBytes)} / ` +
    `KTX2 ${mib(candidate.budgets.ktx2Bytes)} / ` +
    `KTX BRANCH ${mib(candidate.budgets.demoInitialKtx2Bytes)}`;

  if (!navigator.gpu) throw new Error("WebGPU is unavailable in this browser.");
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: "high-performance",
  });
  if (!adapter) throw new Error("No WebGPU adapter was returned.");
  const compression = (
    ["texture-compression-bc", "texture-compression-etc2", "texture-compression-astc"] as const
  ).find((feature) => adapter.features.has(feature));
  const device = await adapter.requestDevice({
    requiredFeatures: compression ? [compression] : [],
  });
  device.lost.then((info) => {
    state.textContent = `DEVICE LOST / ${info.message || info.reason}`;
    state.dataset.state = "error";
  });
  const context = canvas.getContext("webgpu");
  if (!context) {
    device.destroy();
    throw new Error("Canvas could not create a WebGPU context.");
  }
  const canvasContext = context;
  const format = navigator.gpu.getPreferredCanvasFormat();
  canvasContext.configure({ device, format, alphaMode: "opaque" });

  const loader = new ResearchCourtyardV2Loader();
  const loaded = await loader.load({
    baseUrl,
    manifest: candidate.runtimeManifest,
    fetch,
    signal: abort.signal,
  });
  if (loaded.readiness !== "cpu-payload" || !loaded.payload) {
    device.destroy();
    throw new Error(loaded.reason ?? "Candidate CPU payload failed.");
  }
  const payload = loaded.payload;
  const gpuScene = await createResearchCourtyardGpuScene({
    device,
    payload,
    baseUrl,
    fetch,
    signal: abort.signal,
  });
  const renderer = await ResearchCourtyardReferenceRendererV2.create({
    device,
    format,
    payload,
    scene: gpuScene,
  });
  backend.textContent =
    `WEBGPU / ${compression?.replace("texture-compression-", "").toUpperCase() ?? "WEBP"} / ` +
    gpuScene.readiness.toUpperCase();
  state.textContent = "CANDIDATE RUNNING / ACCEPTANCE PENDING";
  state.dataset.state = "ready";

  let width = 1;
  let height = 1;
  let raf = 0;
  let running = true;
  const started = performance.now();
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const resize = new ResizeObserver(([entry]) => {
    const nextWidth = Math.max(1, Math.floor(entry.contentRect.width));
    const nextHeight = Math.max(1, Math.floor(entry.contentRect.height));
    if (width === nextWidth && height === nextHeight) return;
    width = nextWidth;
    height = nextHeight;
    canvas.width = width;
    canvas.height = height;
    renderer.resize(width, height);
    render(performance.now());
  });
  resize.observe(canvas);

  function render(now: number) {
    if (!running || abort.signal.aborted) return;
    const encoder = device.createCommandEncoder({
      label: "Research Courtyard / Review frame",
    });
    renderer.encode(
      encoder,
      canvasContext.getCurrentTexture().createView(),
      (now - started) / 1000,
      {
        lod: Number(lodControl.value) as 0 | 1 | 2,
        debugMode: debugControl.value as ResearchCourtyardDebugMode,
        exposure: Number(exposureControl.value),
      },
    );
    device.queue.submit([encoder.finish()]);
    if (!reducedMotion) raf = requestAnimationFrame(render);
  }

  const rerender = () => {
    exposureValue.value = Number(exposureControl.value).toFixed(2);
    if (!running) {
      running = true;
      render(performance.now());
      running = false;
    }
  };
  lodControl.addEventListener("change", rerender);
  debugControl.addEventListener("change", rerender);
  exposureControl.addEventListener("input", rerender);
  pauseButton.addEventListener("click", () => {
    running = !running;
    pauseButton.textContent = running ? "PAUSE" : "RENDER ONE FRAME";
    pauseButton.setAttribute("aria-pressed", String(!running));
    if (running) render(performance.now());
    else cancelAnimationFrame(raf);
  });

  renderer.resize(width, height);
  render(performance.now());
  if (reducedMotion) {
    running = false;
    pauseButton.textContent = "RENDER ONE FRAME";
    pauseButton.setAttribute("aria-pressed", "true");
  }

  const dispose = () => {
    if (abort.signal.aborted) return;
    abort.abort();
    running = false;
    cancelAnimationFrame(raf);
    resize.disconnect();
    renderer.dispose();
    gpuScene.dispose();
    loader.dispose();
    device.destroy();
  };
  addEventListener("pagehide", dispose, { once: true });
}

start().catch((error) => {
  const state = document.querySelector<HTMLElement>("#review-state");
  if (state) {
    state.textContent = error instanceof Error ? `FAILED / ${error.message}` : "FAILED";
    state.dataset.state = "error";
  }
  console.error(error);
});
