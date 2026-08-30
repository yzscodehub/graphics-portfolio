/* eslint-disable @typescript-eslint/consistent-type-imports -- ONNX Runtime remains explicitly lazy and provider-specific. */
import { clearElement, makeButton, resizeCanvas } from "./core/canvas";
import type { DemoContext, DemoController } from "./core/types";

export type ViewMode = "noisy" | "denoised" | "reference" | "error";

interface HeldoutManifest {
  version: number;
  renderer: string;
  split: "val";
  stem: string;
  sceneSeed: number;
  shape: [1, 3, number, number];
  dtype: "float32-le";
  layout: "NCHW";
  noisySamplesPerPixel: number;
  referenceSamplesPerPixel: number;
  files: {
    noisy: { file: string; bytes: number; sha256: string };
    reference: { file: string; bytes: number; sha256: string };
  };
}

export interface DenoisingFrames {
  size: number;
  reference: Float32Array;
  noisy: Float32Array;
}

export interface ImageMetrics {
  l1: number;
  mse: number;
  psnrDb: number;
}

interface ReviewedRun {
  frames: DenoisingFrames;
  denoised: Float32Array;
  backend: "ONNX Runtime WebGPU" | "ONNX Runtime WASM";
  p50Ms: number;
  p95Ms: number;
  noisyMetrics: ImageMetrics;
  denoisedMetrics: ImageMetrics;
}

export function calculateImageMetrics(
  candidate: Float32Array,
  reference: Float32Array,
): ImageMetrics {
  if (candidate.length !== reference.length || candidate.length === 0)
    throw new Error("Metric inputs must have equal non-zero lengths.");
  let absolute = 0;
  let squared = 0;
  for (let index = 0; index < candidate.length; index += 1) {
    const delta = candidate[index] - reference[index];
    absolute += Math.abs(delta);
    squared += delta * delta;
  }
  const l1 = absolute / candidate.length;
  const mse = squared / candidate.length;
  return { l1, mse, psnrDb: mse === 0 ? Number.POSITIVE_INFINITY : 10 * Math.log10(1 / mse) };
}

export function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

export function createDemo(): DemoController {
  let context: DemoContext;
  let ctx: CanvasRenderingContext2D;
  let width = 1;
  let height = 1;
  let mode: ViewMode = "noisy";
  let run: ReviewedRun | undefined;
  let runningRequest = false;
  let disposed = false;
  let fallbackFrames = makeProceduralFallbackFrames(256);
  const staging = document.createElement("canvas");

  const currentFrames = () => run?.frames ?? fallbackFrames;
  const currentPixels = () => {
    const frames = currentFrames();
    if (mode === "reference") return frames.reference;
    if (mode === "noisy") return frames.noisy;
    const denoised = run?.denoised ?? boxFilter(frames);
    if (mode === "denoised") return denoised;
    return absoluteError(denoised, frames.reference);
  };

  const draw = () => {
    if (!ctx) return;
    const frames = currentFrames();
    const side = Math.max(1, Math.min(width, height) - 32);
    const x = (width - side) / 2;
    const y = (height - side) / 2;
    ctx.fillStyle = "#071011";
    ctx.fillRect(0, 0, width, height);
    staging.width = frames.size;
    staging.height = frames.size;
    staging.getContext("2d")?.putImageData(toImageData(currentPixels(), frames.size), 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(staging, x, y, side, side);
    ctx.strokeStyle = "rgba(87,227,194,.68)";
    ctx.strokeRect(x - 0.5, y - 0.5, side + 1, side + 1);
    ctx.fillStyle = "#e8e6dc";
    ctx.font = "12px ui-monospace, monospace";
    ctx.fillText(
      `${run ? "HELD-OUT" : "STATIC FALLBACK"} · ${mode.toUpperCase()} · ${frames.size}²`,
      16,
      24,
    );
    if (run) {
      ctx.fillStyle = "rgba(232,230,220,.72)";
      ctx.fillText(
        `L1 ${run.denoisedMetrics.l1.toFixed(6)} · PSNR ${run.denoisedMetrics.psnrDb.toFixed(2)} dB · P50 ${run.p50Ms.toFixed(2)} ms`,
        16,
        height - 16,
      );
    }
  };

  const setMode = (next: ViewMode) => {
    mode = next;
    draw();
    if (run)
      context.setMetrics({
        backend: run.backend,
        status: `${mode.toUpperCase()} · P50 ${run.p50Ms.toFixed(2)} ms · P95 ${run.p95Ms.toFixed(2)} ms`,
        inferenceMs: run.p50Ms,
        metricSource: "inference-end-to-end",
      });
  };

  const runReviewedModel = async (button: HTMLButtonElement) => {
    if (runningRequest || disposed) return;
    runningRequest = true;
    button.disabled = true;
    button.textContent = "LOADING REVIEWED MODEL…";
    context.setStatus("Loading hashed held-out pair and ONNX Runtime on explicit request…");
    try {
      const result = await executeReviewedRun(context.signal);
      if (disposed) return;
      run = result;
      mode = "denoised";
      context.setStatus(
        `${result.backend} completed. Current held-out pair: L1 ${result.denoisedMetrics.l1.toFixed(6)}, PSNR ${result.denoisedMetrics.psnrDb.toFixed(2)} dB, P50/P95 ${result.p50Ms.toFixed(2)}/${result.p95Ms.toFixed(2)} ms.`,
        "success",
      );
      setMode(mode);
      button.textContent = "RERUN REVIEWED MODEL";
    } catch (error) {
      if (disposed || context.signal.aborted) return;
      context.setStatus(
        `${error instanceof Error ? error.message : "Reviewed inference failed."} Static fallback remains available.`,
        "warning",
      );
      context.setMetrics({
        backend: "Static fallback",
        status: "reviewed runtime unavailable",
        metricSource: "unavailable",
      });
      button.textContent = "RETRY REVIEWED MODEL";
    } finally {
      runningRequest = false;
      if (!disposed) {
        button.disabled = false;
        draw();
      }
    }
  };

  return {
    async init(next) {
      context = next;
      ctx = resizeCanvas(context.canvas, width, height);
      clearElement(context.controls);
      const viewButtons = (["noisy", "denoised", "reference", "error"] as ViewMode[]).map((view) =>
        makeButton(view.toUpperCase(), view === mode),
      );
      viewButtons.forEach((button, index) =>
        button.addEventListener(
          "click",
          () => {
            viewButtons.forEach((entry) =>
              entry.setAttribute("aria-pressed", String(entry === button)),
            );
            setMode((["noisy", "denoised", "reference", "error"] as ViewMode[])[index]);
          },
          { signal: context.signal },
        ),
      );
      const runButton = makeButton("RUN REVIEWED MODEL");
      runButton.addEventListener("click", () => void runReviewedModel(runButton), {
        signal: context.signal,
      });
      context.controls.append(...viewButtons, runButton);
      context.setStatus(
        "Static deterministic preview loaded. ONNX Runtime and held-out data download only after RUN REVIEWED MODEL.",
        "success",
      );
      context.setMetrics({
        backend: "Static fallback",
        status: "runtime not requested",
        metricSource: "unavailable",
      });
      draw();
    },
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      ctx = resizeCanvas(context.canvas, width, height);
      draw();
    },
    pause() {},
    resume() {
      draw();
    },
    dispose() {
      disposed = true;
      run = undefined;
      fallbackFrames = makeProceduralFallbackFrames(16);
    },
  };
}

async function executeReviewedRun(signal: AbortSignal): Promise<ReviewedRun> {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  const root = `${base}/models/heldout`;
  const manifestResponse = await fetch(`${root}/manifest.json`, { signal });
  if (!manifestResponse.ok) throw new Error("Held-out manifest is unavailable.");
  const manifest = (await manifestResponse.json()) as HeldoutManifest;
  validateManifest(manifest);
  const [noisy, reference] = await Promise.all([
    fetchVerifiedFloat(`${root}/${manifest.files.noisy.file}`, manifest.files.noisy, signal),
    fetchVerifiedFloat(
      `${root}/${manifest.files.reference.file}`,
      manifest.files.reference,
      signal,
    ),
  ]);
  const frames: DenoisingFrames = { size: manifest.shape[2], noisy, reference };
  const modelUrl = `${base}/models/neural-denoiser.onnx`;
  const modelResponse = await fetch(modelUrl, { signal });
  if (!modelResponse.ok) throw new Error("Reviewed ONNX model is unavailable.");
  const modelBytes = new Uint8Array(await modelResponse.arrayBuffer());
  if (!modelBytes.byteLength || modelBytes.byteLength > 5 * 1024 * 1024)
    throw new Error("Reviewed ONNX model size is outside the published contract.");

  const backends: Array<"webgpu" | "wasm"> = navigator.gpu ? ["webgpu", "wasm"] : ["wasm"];
  const failures: string[] = [];
  for (const requestedBackend of backends) {
    throwIfAborted(signal);
    let attempt: Awaited<ReturnType<typeof createOnnxSession>> | undefined;
    try {
      attempt = await createOnnxSession(modelBytes, requestedBackend);
      throwIfAborted(signal);
      return await runOnnxSession(attempt, frames, manifest.shape, signal);
    } catch (error) {
      throwIfAborted(signal);
      failures.push(
        `${requestedBackend}: ${error instanceof Error ? error.message : "runtime failure"}`,
      );
    } finally {
      if (attempt) await attempt.session.release().catch(() => undefined);
    }
  }
  throw new Error(`Reviewed inference failed on every backend (${failures.join("; ")}).`);
}

async function runOnnxSession(
  attempt: Awaited<ReturnType<typeof createOnnxSession>>,
  frames: DenoisingFrames,
  shape: HeldoutManifest["shape"],
  signal: AbortSignal,
): Promise<ReviewedRun> {
  const { ort, session, backend } = attempt;
  const input = new ort.Tensor("float32", frames.noisy, shape);
  try {
    for (let index = 0; index < 5; index += 1) {
      throwIfAborted(signal);
      releaseTensorMap(await session.run({ [session.inputNames[0]]: input }));
    }
    const samples: number[] = [];
    let outputData: Float32Array | undefined;
    for (let index = 0; index < 20; index += 1) {
      throwIfAborted(signal);
      const started = performance.now();
      const outputs = await session.run({ [session.inputNames[0]]: input });
      samples.push(performance.now() - started);
      const output = outputs[session.outputNames[0]];
      if (!output || output.data.length !== frames.noisy.length) {
        releaseTensorMap(outputs);
        throw new Error("ONNX output shape does not match the reviewed held-out pair.");
      }
      outputData = Float32Array.from(output.data as Float32Array);
      releaseTensorMap(outputs);
    }
    if (!outputData) throw new Error("ONNX Runtime produced no reviewed output.");
    return {
      frames,
      denoised: outputData,
      backend,
      p50Ms: percentile(samples, 0.5),
      p95Ms: percentile(samples, 0.95),
      noisyMetrics: calculateImageMetrics(frames.noisy, frames.reference),
      denoisedMetrics: calculateImageMetrics(outputData, frames.reference),
    };
  } finally {
    input.dispose();
  }
}

function releaseTensorMap(outputs: Record<string, import("onnxruntime-web").Tensor>): void {
  Object.values(outputs).forEach((tensor) => tensor.dispose());
}

async function createOnnxSession(
  modelBytes: Uint8Array,
  requestedBackend: "webgpu" | "wasm",
): Promise<{
  ort: typeof import("onnxruntime-web");
  session: import("onnxruntime-web").InferenceSession;
  backend: "ONNX Runtime WebGPU" | "ONNX Runtime WASM";
}> {
  if (requestedBackend === "webgpu") {
    const ort = await import("onnxruntime-web/webgpu");
    const session = await ort.InferenceSession.create(modelBytes, {
      executionProviders: ["webgpu"],
    });
    return { ort, session, backend: "ONNX Runtime WebGPU" };
  }
  const ort = await import("onnxruntime-web");
  ort.env.wasm.numThreads = 1;
  const session = await ort.InferenceSession.create(modelBytes, { executionProviders: ["wasm"] });
  return { ort, session, backend: "ONNX Runtime WASM" };
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

function validateManifest(manifest: HeldoutManifest): void {
  if (
    manifest.version !== 1 ||
    manifest.split !== "val" ||
    manifest.dtype !== "float32-le" ||
    manifest.layout !== "NCHW" ||
    manifest.shape[0] !== 1 ||
    manifest.shape[1] !== 3 ||
    manifest.shape[2] !== manifest.shape[3]
  )
    throw new Error("Held-out manifest contract is incompatible.");
}

async function fetchVerifiedFloat(
  url: string,
  expected: { bytes: number; sha256: string },
  signal: AbortSignal,
): Promise<Float32Array> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Held-out asset failed to load: ${url}`);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength !== expected.bytes) throw new Error("Held-out asset byte length mismatch.");
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const actual = Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  if (actual !== expected.sha256) throw new Error("Held-out asset SHA-256 mismatch.");
  if (!isLittleEndian()) throw new Error("Held-out float assets require a little-endian browser.");
  return new Float32Array(buffer);
}

function isLittleEndian(): boolean {
  const buffer = new ArrayBuffer(2);
  new DataView(buffer).setUint16(0, 0x00ff, true);
  return new Uint16Array(buffer)[0] === 0x00ff;
}

export function makeDenoisingView(
  mode: ViewMode,
  frames: DenoisingFrames,
  onnxDenoised?: Float32Array,
): Float32Array {
  if (mode === "reference") return new Float32Array(frames.reference);
  if (mode === "noisy") return new Float32Array(frames.noisy);
  const denoised = onnxDenoised ?? boxFilter(frames);
  if (mode === "denoised") return new Float32Array(denoised);
  return absoluteError(denoised, frames.reference);
}

function boxFilter(frames: DenoisingFrames): Float32Array {
  const { size, noisy } = frames;
  const result = new Float32Array(noisy.length);
  const plane = size * size;
  for (let channel = 0; channel < 3; channel += 1)
    for (let y = 0; y < size; y += 1)
      for (let x = 0; x < size; x += 1) {
        let sum = 0;
        let weight = 0;
        for (let oy = -1; oy <= 1; oy += 1)
          for (let ox = -1; ox <= 1; ox += 1) {
            const sx = Math.max(0, Math.min(size - 1, x + ox));
            const sy = Math.max(0, Math.min(size - 1, y + oy));
            const spatial = ox === 0 && oy === 0 ? 4 : 1;
            sum += noisy[channel * plane + sy * size + sx] * spatial;
            weight += spatial;
          }
        result[channel * plane + y * size + x] = sum / weight;
      }
  return result;
}

function absoluteError(candidate: Float32Array, reference: Float32Array): Float32Array {
  const result = new Float32Array(reference.length);
  for (let index = 0; index < reference.length; index += 1)
    result[index] = Math.min(1, Math.abs(reference[index] - candidate[index]) * 4);
  return result;
}

function toImageData(nchw: Float32Array, size: number): ImageData {
  const pixels = new Uint8ClampedArray(size * size * 4);
  const plane = size * size;
  for (let index = 0; index < plane; index += 1) {
    pixels[index * 4] = clamp(nchw[index]) * 255;
    pixels[index * 4 + 1] = clamp(nchw[plane + index]) * 255;
    pixels[index * 4 + 2] = clamp(nchw[plane * 2 + index]) * 255;
    pixels[index * 4 + 3] = 255;
  }
  return new ImageData(pixels, size, size);
}

export function makeProceduralFallbackFrames(size: number): DenoisingFrames {
  const plane = size * size;
  const reference = new Float32Array(plane * 3);
  const noisy = new Float32Array(plane * 3);
  for (let y = 0; y < size; y += 1)
    for (let x = 0; x < size; x += 1) {
      const u = x / Math.max(size - 1, 1);
      const v = y / Math.max(size - 1, 1);
      const index = y * size + x;
      const sphere = Math.max(0, 1 - ((u - 0.52) ** 2 + (v - 0.5) ** 2) * 7.4);
      const light = Math.max(0.08, 0.22 + sphere * 0.76 + Math.sin(u * 9 + v * 5) * 0.04);
      const channels = [light * 0.42, light * 0.92, light * 0.76];
      const noise = (deterministic(x * 31 + y * 17) - 0.5) * 0.38;
      for (let channel = 0; channel < 3; channel += 1) {
        reference[channel * plane + index] = clamp(channels[channel]);
        noisy[channel * plane + index] = clamp(channels[channel] + noise);
      }
    }
  return { size, reference, noisy };
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function deterministic(seed: number): number {
  return Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1;
}
