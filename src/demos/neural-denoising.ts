import { clearElement, makeButton, resizeCanvas } from "./core/canvas";
import type { DemoContext, DemoController } from "./core/types";

export type ViewMode = "noisy" | "denoised" | "reference" | "error";

const FRAME_SIZE = 256;

export interface DenoisingFrames {
  size: number;
  reference: Uint8ClampedArray;
  noisy: Uint8ClampedArray;
}

export function createDemo(): DemoController {
  let context: DemoContext;
  let ctx: CanvasRenderingContext2D;
  let width = 1;
  let height = 1;
  let mode: ViewMode = "noisy";
  let image: ImageData | undefined;
  let onnxDenoised: Uint8ClampedArray | undefined;
  let inferenceBackend = "Deterministic Canvas fallback";
  let measuredInferenceMs: number | undefined;
  const frames = makeFrames(FRAME_SIZE);
  const staging = document.createElement("canvas");
  const draw = () => {
    if (!image) return;
    const side = Math.min(width, height) - 32;
    const x = (width - side) / 2;
    const y = (height - side) / 2;
    ctx.fillStyle = "#071011";
    ctx.fillRect(0, 0, width, height);
    staging.width = image.width;
    staging.height = image.height;
    staging.getContext("2d")?.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(staging, x, y, side, side);
    ctx.strokeStyle = "rgba(87,227,194,.68)";
    ctx.strokeRect(x - 0.5, y - 0.5, side + 1, side + 1);
    ctx.fillStyle = "#e8e6dc";
    ctx.font = "12px ui-monospace, monospace";
    ctx.fillText(`DETERMINISTIC ${mode.toUpperCase()} VIEW`, 16, 24);
    ctx.fillStyle = "rgba(232,230,220,.62)";
    ctx.fillText(getViewDetail(mode, Boolean(onnxDenoised)), 16, height - 16);
  };
  const setMode = (next: ViewMode, announce = true) => {
    mode = next;
    image = makeImageData(makeDenoisingView(mode, frames, onnxDenoised), frames.size);
    context.setMetrics({
      backend: inferenceBackend,
      status: mode.toUpperCase(),
      inferenceMs: measuredInferenceMs,
    });
    if (announce)
      context.setStatus(
        getViewStatus(mode, Boolean(onnxDenoised)),
        mode === "error" && !onnxDenoised ? "warning" : "info",
      );
    draw();
  };
  return {
    async init(next) {
      context = next;
      ctx = resizeCanvas(context.canvas, width, height);
      clearElement(context.controls);
      const inference = await tryOnnxInference(frames);
      onnxDenoised = inference.pixels;
      inferenceBackend = inference.backend ?? "Deterministic Canvas fallback";
      measuredInferenceMs = inference.inferenceMs;
      context.setStatus(inference.status, inference.pixels ? "success" : "warning");
      context.setMetrics({
        backend: inference.backend ?? "Deterministic Canvas fallback",
        status: inference.pixels ? "MODEL READY" : "FALLBACK",
        inferenceMs: inference.inferenceMs,
      });
      (["noisy", "denoised", "reference", "error"] as ViewMode[]).forEach((view) => {
        const button = makeButton(view.toUpperCase(), view === mode);
        button.addEventListener(
          "click",
          () => {
            setMode(view);
            context.controls
              .querySelectorAll("button")
              .forEach((entry) => entry.setAttribute("aria-pressed", String(entry === button)));
          },
          { signal: context.signal },
        );
        context.controls.append(button);
      });
      setMode(mode, false);
    },
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      ctx = resizeCanvas(context.canvas, width, height);
      setMode(mode, false);
    },
    pause() {},
    resume() {
      draw();
    },
    dispose() {},
  };
}

async function tryOnnxInference(frames: DenoisingFrames): Promise<{
  pixels?: Uint8ClampedArray;
  status: string;
  backend?: string;
  inferenceMs?: number;
}> {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  const modelUrl = `${base}/models/neural-denoiser.onnx`;
  try {
    const response = await fetch(modelUrl, { method: "HEAD" });
    if (!response.ok)
      return { status: "ONNX model is not deployed; using deterministic local fallback." };
    const ort = await import("onnxruntime-web/webgpu");
    const session = await ort.InferenceSession.create(modelUrl, {
      executionProviders: ["webgpu", "wasm"],
    });
    try {
      const { noisy, size } = frames;
      const input = new Float32Array(3 * size * size);
      for (let y = 0; y < size; y += 1)
        for (let x = 0; x < size; x += 1)
          for (let channel = 0; channel < 3; channel += 1) {
            input[channel * size * size + y * size + x] = noisy[(y * size + x) * 4 + channel] / 255;
          }
      const inferenceStart = performance.now();
      const result = await session.run({
        [session.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, size, size]),
      });
      const inferenceMs = performance.now() - inferenceStart;
      const output = result[session.outputNames[0]];
      if (!output || output.data.length < 3 * size * size)
        return {
          status: "ONNX model output shape is incompatible; using deterministic local fallback.",
        };
      const pixels = new Uint8ClampedArray(size * size * 4);
      for (let y = 0; y < size; y += 1)
        for (let x = 0; x < size; x += 1) {
          const pixel = (y * size + x) * 4;
          for (let channel = 0; channel < 3; channel += 1)
            pixels[pixel + channel] = Math.round(
              clamp(Number(output.data[channel * size * size + y * size + x])) * 255,
            );
          pixels[pixel + 3] = 255;
        }
      return {
        pixels,
        status:
          "Reviewed ONNX model inference completed locally; WebGPU is preferred with WASM fallback.",
        backend: "ONNX Runtime WebGPU/WASM",
        inferenceMs,
      };
    } finally {
      await session.release();
    }
  } catch {
    return { status: "Model inference could not start; using deterministic local fallback." };
  }
}

export function makeDenoisingView(
  mode: ViewMode,
  frames: DenoisingFrames,
  onnxDenoised?: Uint8ClampedArray,
): Uint8ClampedArray {
  const { reference, noisy } = frames;
  if (mode === "reference") {
    const copy = new Uint8ClampedArray(reference.length);
    copy.set(reference);
    return copy;
  }
  if (mode === "noisy") {
    const copy = new Uint8ClampedArray(noisy.length);
    copy.set(noisy);
    return copy;
  }
  const denoised = onnxDenoised ?? makeFallbackDenoised(frames);
  if (mode === "denoised") return new Uint8ClampedArray(denoised);
  return makeAbsoluteError(reference, denoised);
}

function makeImageData(pixels: Uint8ClampedArray, size: number): ImageData {
  const copiedPixels = new Uint8ClampedArray(pixels.length);
  copiedPixels.set(pixels);
  return new ImageData(copiedPixels, size, size);
}

function makeFallbackDenoised({ size, noisy }: DenoisingFrames): Uint8ClampedArray {
  const result = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1)
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        let sum = 0;
        let weight = 0;
        for (let oy = -1; oy <= 1; oy += 1)
          for (let ox = -1; ox <= 1; ox += 1) {
            const sx = Math.max(0, Math.min(size - 1, x + ox));
            const sy = Math.max(0, Math.min(size - 1, y + oy));
            const source = (sy * size + sx) * 4 + channel;
            const spatial = ox === 0 && oy === 0 ? 4 : 1;
            sum += noisy[source] * spatial;
            weight += spatial;
          }
        const denoised = sum / weight;
        result[index + channel] = denoised;
      }
      result[index + 3] = 255;
    }
  return result;
}

function makeAbsoluteError(
  reference: Uint8ClampedArray,
  candidate: Uint8ClampedArray,
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(reference.length);
  for (let index = 0; index < reference.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1)
      result[index + channel] =
        Math.abs(reference[index + channel] - candidate[index + channel]) * 4;
    result[index + 3] = 255;
  }
  return result;
}

function getViewDetail(mode: ViewMode, hasOnnxDenoised: boolean): string {
  if (mode === "error")
    return hasOnnxDenoised
      ? "Absolute error: ONNX output compared with the current deterministic reference."
      : "Approximate error: box-filter fallback compared with the current deterministic reference.";
  return hasOnnxDenoised
    ? "Reviewed local ONNX model / deterministic procedural runtime probe."
    : "Deterministic visual fallback / ONNX inference unavailable.";
}

function getViewStatus(mode: ViewMode, hasOnnxDenoised: boolean): string {
  if (mode === "error")
    return hasOnnxDenoised
      ? "Showing absolute error between ONNX output and the current reference."
      : "Showing approximate error from the deterministic box-filter fallback. ONNX inference is unavailable.";
  return hasOnnxDenoised
    ? `Showing ${mode} from the local ONNX review run.`
    : `Showing ${mode}; deterministic fallback is active.`;
}

export function makeFrames(size: number): DenoisingFrames {
  const reference = new Uint8ClampedArray(size * size * 4);
  const noisy = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1)
    for (let x = 0; x < size; x += 1) {
      const u = x / (size - 1);
      const v = y / (size - 1);
      const index = (y * size + x) * 4;
      const sphere = Math.max(0, 1 - ((u - 0.52) ** 2 + (v - 0.5) ** 2) * 7.4);
      const light = Math.max(0.08, 0.22 + sphere * 0.76 + Math.sin(u * 9 + v * 5) * 0.04);
      const channels = [light * 0.42, light * 0.92, light * 0.76];
      const noise = (deterministic(x * 31 + y * 17) - 0.5) * 0.38;
      for (let channel = 0; channel < 3; channel += 1) {
        reference[index + channel] = Math.round(clamp(channels[channel]) * 255);
        noisy[index + channel] = Math.round(clamp(channels[channel] + noise) * 255);
      }
      reference[index + 3] = 255;
      noisy[index + 3] = 255;
    }
  return { size, reference, noisy };
}
function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}
function deterministic(seed: number): number {
  return Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1;
}
