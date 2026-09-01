/* eslint-disable @typescript-eslint/consistent-type-imports -- ONNX Runtime remains explicitly lazy and provider-specific. */
import {
  normalizeHeldoutManifest,
  normalizeNeuralModelManifest,
  type GuidedStaticCandidate,
} from "./neural-v2-contract";
import { clearElement, makeButton, resizeCanvas } from "./core/canvas";
import type {
  DemoContext,
  DemoController,
  DemoResourceScope,
  InferenceSessionLike,
} from "./core/types";

export type ViewMode = "noisy" | "denoised" | "reference" | "error";

export interface ArtifactDescriptor {
  file: string;
  bytes: number;
  sha256: string;
}

interface TensorContract {
  name: string;
  dtype: "float32";
  shape: [1, 3, 256, 256];
  layout: "NCHW";
  range: "[0,1]";
}

export interface ModelManifest {
  version: 1;
  model: ArtifactDescriptor & {
    format: "onnx";
    opset: 17;
    input: TensorContract;
    output: TensorContract;
  };
  heldoutManifest: ArtifactDescriptor;
}

interface HeldoutManifest {
  version: number;
  renderer: string;
  split: "val";
  stem: string;
  sceneSeed: number;
  shape: [1, 3, number, number];
  dtype: "float16-le";
  layout: "NCHW";
  noisySamplesPerPixel: number;
  referenceSamplesPerPixel: number;
  export: {
    version: "reviewed-web-pair-v2";
    assetStem: "scene-0001";
    sourceDatasetStem: "scene-0064";
    datasetManifestSha256: string;
  };
  files: {
    noisy: ArtifactDescriptor;
    reference: ArtifactDescriptor;
  };
}

export interface DenoisingFrames {
  size: number;
  reference: Float32Array;
  noisy: Float32Array;
  albedo?: Float32Array;
  worldNormal?: Float32Array;
}

export interface ImageMetrics {
  l1: number;
  mse: number;
  psnrDb: number;
}

interface GuidedCandidateRun {
  kind: "candidate";
  frames: DenoisingFrames;
  denoised: Float32Array;
  reason: string;
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

/** Keeps an explicit user action as the only entry point for model loading. */
export class ExplicitRunGate {
  private requestPromise: Promise<unknown> | undefined;

  get inFlight(): boolean {
    return this.requestPromise !== undefined;
  }

  async request<T>(loader: () => Promise<T>): Promise<T> {
    if (this.requestPromise) throw new Error("A reviewed model request is already in progress.");
    const request = loader();
    this.requestPromise = request;
    try {
      return await request;
    } finally {
      if (this.requestPromise === request) this.requestPromise = undefined;
    }
  }
}

/** Releases an ONNX session at most once across normal completion and dispose. */
export class SessionLease implements InferenceSessionLike {
  private releasePromise: Promise<void> | undefined;
  private activeOperations = 0;
  private releaseRequested = false;
  private idleResolvers: Array<() => void> = [];

  constructor(private readonly session: InferenceSessionLike) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.releaseRequested) throw new Error("ONNX session release is already pending.");
    this.activeOperations += 1;
    try {
      return await operation();
    } finally {
      this.activeOperations -= 1;
      if (this.activeOperations === 0) {
        this.idleResolvers.splice(0).forEach((resolve) => resolve());
      }
    }
  }

  release(): Promise<void> {
    this.releaseRequested = true;
    this.releasePromise ??= (async () => {
      if (this.activeOperations > 0) {
        await new Promise<void>((resolve) => this.idleResolvers.push(resolve));
      }
      await this.session.release();
    })();
    return this.releasePromise;
  }
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
  let guidedCandidate: GuidedCandidateRun | undefined;
  const reviewedRunGate = new ExplicitRunGate();
  let disposed = false;
  let fallbackFrames = makeProceduralFallbackFrames(256);
  const staging = document.createElement("canvas");

  const currentFrames = () => guidedCandidate?.frames ?? run?.frames ?? fallbackFrames;
  const currentPixels = () => {
    const frames = currentFrames();
    if (mode === "reference") return frames.reference;
    if (mode === "noisy") return frames.noisy;
    const denoised = guidedCandidate?.denoised ?? run?.denoised ?? boxFilter(frames);
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
    if (reviewedRunGate.inFlight || disposed) return;
    button.disabled = true;
    button.textContent = "LOADING REVIEWED MODEL…";
    context.setStatus("Loading hashed held-out pair and ONNX Runtime on explicit request…");
    try {
      const result = await reviewedRunGate.request(() =>
        executeReviewedRun(context.signal, context.resources),
      );
      if (disposed) return;
      guidedCandidate = undefined;
      run = result;
      mode = "denoised";
      context.setRuntimeState?.("running");
      context.setStatus(
        `${result.backend} completed. Current held-out pair: L1 ${result.denoisedMetrics.l1.toFixed(6)}, PSNR ${result.denoisedMetrics.psnrDb.toFixed(2)} dB, P50/P95 ${result.p50Ms.toFixed(2)}/${result.p95Ms.toFixed(2)} ms.`,
        "success",
      );
      setMode(mode);
      button.textContent = "RERUN REVIEWED MODEL";
    } catch (error) {
      if (disposed || context.signal.aborted) return;
      context.setRuntimeState?.("fallback");
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
      if (!disposed) {
        button.disabled = false;
        draw();
      }
    }
  };

  const showGuidedCandidate = async (button: HTMLButtonElement) => {
    if (reviewedRunGate.inFlight || disposed) return;
    button.disabled = true;
    button.textContent = "LOADING GUIDED CANDIDATE…";
    context.setStatus(
      "Loading hashed guidance artifacts. This candidate has not passed quality review.",
    );
    try {
      const result = await reviewedRunGate.request(() => loadGuidedStaticCandidate(context.signal));
      if (disposed) return;
      run = undefined;
      guidedCandidate = result;
      mode = "denoised";
      context.setRuntimeState?.("fallback");
      context.setStatus(
        "Guided candidate is a static, unreviewed contract artifact. " +
          result.reason +
          " It is not an ONNX model and no quality metric is claimed.",
        "warning",
      );
      context.setMetrics({
        backend: "Guided static candidate",
        status: "unreviewed; metrics deliberately withheld",
        metricSource: "unavailable",
      });
      button.textContent = "RELOAD GUIDED CANDIDATE";
    } catch (error) {
      if (disposed || context.signal.aborted) return;
      context.setStatus(
        (error instanceof Error ? error.message : "Guided candidate failed to load.") +
          " The reviewed RGB path remains available.",
        "warning",
      );
      button.textContent = "RETRY GUIDED CANDIDATE";
    } finally {
      if (!disposed) {
        button.disabled = false;
        draw();
      }
    }
  };

  return {
    async init(next) {
      context = next;
      context.setRuntimeState?.("fallback");
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
      const candidateButton = makeButton("SHOW GUIDED CANDIDATE");
      candidateButton.addEventListener("click", () => void showGuidedCandidate(candidateButton), {
        signal: context.signal,
      });
      context.controls.append(...viewButtons, runButton, candidateButton);
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

export async function executeReviewedRun(
  signal: AbortSignal,
  resources?: DemoResourceScope,
): Promise<ReviewedRun> {
  return executeReviewedRgbV2(signal, resources);
}

export async function loadGuidedStaticCandidate(signal: AbortSignal): Promise<GuidedCandidateRun> {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  const modelRoot = base + "/models";
  const rawModelManifest = await fetchJson<unknown>(
    modelRoot + "/neural-denoiser.manifest.json",
    "Neural model manifest",
    signal,
  );
  const modelManifest = normalizeNeuralModelManifest(rawModelManifest);
  const candidate: GuidedStaticCandidate | undefined = modelManifest.guided;
  if (!candidate || candidate.status !== "candidate")
    throw new Error("Guided model is not an unreviewed static candidate.");
  const heldoutBuffer = await fetchVerifiedBytes(
    modelRoot + "/" + modelManifest.heldoutManifest.file,
    modelManifest.heldoutManifest,
    "Held-out manifest",
    signal,
  );
  const heldout = normalizeHeldoutManifest(parseJson<unknown>(heldoutBuffer, "Held-out manifest"));
  if (!heldout.files.albedo || !heldout.files.worldNormal || !heldout.files.guidedCandidate)
    throw new Error(
      "Guided candidate requires v2 albedo, world-normal, and static-output artifacts.",
    );
  if (candidate.candidateOutput.file !== "heldout/" + heldout.files.guidedCandidate.file)
    throw new Error("Guided candidate output is not bound to the held-out candidate artifact.");
  const heldoutRoot = modelRoot + "/heldout";
  const [noisy, reference, albedo, worldNormal, denoised] = await Promise.all([
    fetchVerifiedFloat16(heldoutRoot + "/" + heldout.files.noisy.file, heldout.files.noisy, signal),
    fetchVerifiedFloat16(
      heldoutRoot + "/" + heldout.files.reference.file,
      heldout.files.reference,
      signal,
    ),
    fetchVerifiedFloat16(
      heldoutRoot + "/" + heldout.files.albedo.file,
      heldout.files.albedo,
      signal,
    ),
    fetchVerifiedFloat16(
      heldoutRoot + "/" + heldout.files.worldNormal.file,
      heldout.files.worldNormal,
      signal,
    ),
    fetchVerifiedFloat16(
      modelRoot + "/" + candidate.candidateOutput.file,
      candidate.candidateOutput,
      signal,
    ),
  ]);
  return {
    kind: "candidate",
    frames: { size: heldout.shape[2], noisy, reference, albedo, worldNormal },
    denoised,
    reason: candidate.reason,
  };
}

async function executeReviewedRgbV2(
  signal: AbortSignal,
  resources?: DemoResourceScope,
): Promise<ReviewedRun> {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  const modelRoot = base + "/models";
  const rawModelManifest = await fetchJson<unknown>(
    modelRoot + "/neural-denoiser.manifest.json",
    "Neural model manifest",
    signal,
  );
  const modelManifest = normalizeNeuralModelManifest(rawModelManifest);
  const heldoutBuffer = await fetchVerifiedBytes(
    modelRoot + "/" + modelManifest.heldoutManifest.file,
    modelManifest.heldoutManifest,
    "Held-out manifest",
    signal,
  );
  const heldout = normalizeHeldoutManifest(parseJson<unknown>(heldoutBuffer, "Held-out manifest"));
  const heldoutRoot = modelRoot + "/heldout";
  const [noisy, reference, modelBuffer] = await Promise.all([
    fetchVerifiedFloat16(heldoutRoot + "/" + heldout.files.noisy.file, heldout.files.noisy, signal),
    fetchVerifiedFloat16(
      heldoutRoot + "/" + heldout.files.reference.file,
      heldout.files.reference,
      signal,
    ),
    fetchVerifiedBytes(
      modelRoot + "/" + modelManifest.rgb.file,
      modelManifest.rgb,
      "Reviewed RGB ONNX model",
      signal,
    ),
  ]);
  const frames: DenoisingFrames = { size: heldout.shape[2], noisy, reference };
  const modelBytes = new Uint8Array(modelBuffer);
  const backends: Array<"webgpu" | "wasm"> = navigator.gpu ? ["webgpu", "wasm"] : ["wasm"];
  const failures: string[] = [];
  for (const requestedBackend of backends) {
    throwIfAborted(signal);
    let lease: SessionLease | undefined;
    try {
      const attempt = await createOnnxSession(modelBytes, requestedBackend);
      lease = new SessionLease(attempt.session);
      resources?.trackInferenceSession(lease);
      validateSessionContract(attempt.session, modelManifest.rgb);
      return await runOnnxSession(attempt, lease, frames, modelManifest.rgb.input.shape, signal);
    } catch (error) {
      throwIfAborted(signal);
      failures.push(
        requestedBackend + ": " + (error instanceof Error ? error.message : "runtime failure"),
      );
    } finally {
      if (lease) await lease.release().catch(() => undefined);
    }
  }
  throw new Error("Reviewed RGB inference failed on every backend (" + failures.join("; ") + ").");
}

async function runOnnxSession(
  attempt: Awaited<ReturnType<typeof createOnnxSession>>,
  lease: SessionLease,
  frames: DenoisingFrames,
  shape: HeldoutManifest["shape"],
  signal: AbortSignal,
): Promise<ReviewedRun> {
  const { ort, session, backend } = attempt;
  const input = new ort.Tensor("float32", frames.noisy, shape);
  try {
    for (let index = 0; index < 5; index += 1) {
      throwIfAborted(signal);
      const outputs = await lease.run(() => session.run({ [session.inputNames[0]]: input }));
      try {
        throwIfAborted(signal);
      } finally {
        releaseTensorMap(outputs);
      }
    }
    const samples: number[] = [];
    let outputData: Float32Array | undefined;
    for (let index = 0; index < 20; index += 1) {
      throwIfAborted(signal);
      const started = performance.now();
      const outputs = await lease.run(() => session.run({ [session.inputNames[0]]: input }));
      try {
        throwIfAborted(signal);
        samples.push(performance.now() - started);
        const output = outputs[session.outputNames[0]];
        if (!output || output.data.length !== frames.noisy.length)
          throw new Error("ONNX output shape does not match the reviewed held-out pair.");
        outputData = Float32Array.from(output.data as Float32Array);
      } finally {
        releaseTensorMap(outputs);
      }
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

function validateSessionContract(
  session: Pick<import("onnxruntime-web").InferenceSession, "inputNames" | "outputNames">,
  model: ModelManifest["model"],
): void {
  if (
    session.inputNames.length !== 1 ||
    session.outputNames.length !== 1 ||
    session.inputNames[0] !== model.input.name ||
    session.outputNames[0] !== model.output.name
  )
    throw new Error("ONNX session input/output names do not match the reviewed model contract.");
}

export function validateModelManifest(manifest: unknown): asserts manifest is ModelManifest {
  if (!isRecord(manifest) || manifest.version !== 1 || !isRecord(manifest.model))
    throw new Error("Reviewed model manifest contract is incompatible.");
  const { model, heldoutManifest } = manifest;
  if (
    !isModelArtifact(model) ||
    model.file !== "neural-denoiser.onnx" ||
    model.format !== "onnx" ||
    model.opset !== 17 ||
    !isTensorContract(model.input, "noisy_rgb") ||
    !isTensorContract(model.output, "denoised_rgb") ||
    !isArtifactDescriptor(heldoutManifest) ||
    heldoutManifest.file !== "heldout/manifest.json"
  )
    throw new Error("Reviewed model manifest contract is incompatible.");
}

export function validateHeldoutManifest(manifest: unknown): asserts manifest is HeldoutManifest {
  if (!isRecord(manifest) || !isRecord(manifest.export) || !isRecord(manifest.files))
    throw new Error("Held-out manifest contract is incompatible.");
  const { export: exportRecord, files } = manifest;
  if (
    manifest.version !== 1 ||
    manifest.renderer !== "procedural-cornell-mc-v1" ||
    manifest.split !== "val" ||
    manifest.stem !== "scene-0001" ||
    manifest.sceneSeed !== 91_103 ||
    manifest.dtype !== "float16-le" ||
    manifest.layout !== "NCHW" ||
    !isExactShape(manifest.shape) ||
    manifest.noisySamplesPerPixel !== 1 ||
    manifest.referenceSamplesPerPixel !== 64 ||
    exportRecord.version !== "reviewed-web-pair-v2" ||
    exportRecord.assetStem !== "scene-0001" ||
    exportRecord.sourceDatasetStem !== "scene-0064" ||
    !isSha256(exportRecord.datasetManifestSha256) ||
    !isArtifactDescriptor(files.noisy) ||
    !isArtifactDescriptor(files.reference) ||
    files.noisy.file !== "scene-0001-noisy.f16" ||
    files.reference.file !== "scene-0001-reference.f16"
  )
    throw new Error("Held-out manifest contract is incompatible.");
}

export function decodeFloat16LittleEndian(buffer: ArrayBuffer): Float32Array {
  if (buffer.byteLength === 0 || buffer.byteLength % 2 !== 0)
    throw new Error("Float16 artifact byte length must be a non-zero multiple of two.");
  const source = new DataView(buffer);
  const result = new Float32Array(buffer.byteLength / 2);
  for (let index = 0; index < result.length; index += 1) {
    const bits = source.getUint16(index * 2, true);
    const sign = bits & 0x8000 ? -1 : 1;
    const exponent = (bits >>> 10) & 0x1f;
    const mantissa = bits & 0x03ff;
    if (exponent === 0) result[index] = sign * mantissa * 2 ** -24;
    else if (exponent === 0x1f)
      result[index] = mantissa === 0 ? sign * Number.POSITIVE_INFINITY : Number.NaN;
    else result[index] = sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
  }
  return result;
}

async function fetchVerifiedFloat16(
  url: string,
  expected: ArtifactDescriptor,
  signal: AbortSignal,
): Promise<Float32Array> {
  const buffer = await fetchVerifiedBytes(url, expected, "Held-out asset", signal);
  if (!isLittleEndian()) throw new Error("Held-out float assets require a little-endian browser.");
  return decodeFloat16LittleEndian(buffer);
}

async function fetchVerifiedBytes(
  url: string,
  expected: ArtifactDescriptor,
  label: string,
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${label} failed to load: ${url}`);
  const buffer = await response.arrayBuffer();
  await verifyArtifactBuffer(buffer, expected, label);
  return buffer;
}

async function fetchJson<T>(url: string, label: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${label} failed to load: ${url}`);
  return parseJson<T>(await response.arrayBuffer(), label);
}

function parseJson<T>(buffer: ArrayBuffer, label: string): T {
  try {
    return JSON.parse(new TextDecoder().decode(buffer)) as T;
  } catch (error) {
    throw new Error(`${label} is not valid JSON.`, { cause: error });
  }
}

export async function verifyArtifactBuffer(
  buffer: ArrayBuffer,
  expected: ArtifactDescriptor,
  label: string,
): Promise<void> {
  if (!isArtifactDescriptor(expected)) throw new Error(`${label} descriptor is incompatible.`);
  if (buffer.byteLength !== expected.bytes) throw new Error(`${label} byte length mismatch.`);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const actual = Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  if (actual !== expected.sha256) throw new Error(`${label} SHA-256 mismatch.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function isArtifactDescriptor(value: unknown): value is ArtifactDescriptor {
  if (!isRecord(value) || typeof value.file !== "string" || !isSha256(value.sha256)) return false;
  const bytes = value.bytes;
  return (
    value.file.length > 0 && typeof bytes === "number" && Number.isSafeInteger(bytes) && bytes > 0
  );
}

function isModelArtifact(value: unknown): value is ModelManifest["model"] {
  return (
    isArtifactDescriptor(value) &&
    isRecord(value) &&
    value.format === "onnx" &&
    value.opset === 17 &&
    isTensorContract(value.input, "noisy_rgb") &&
    isTensorContract(value.output, "denoised_rgb")
  );
}

function isExactShape(value: unknown): value is [1, 3, 256, 256] {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value[0] === 1 &&
    value[1] === 3 &&
    value[2] === 256 &&
    value[3] === 256
  );
}

function isTensorContract(value: unknown, name: string): value is TensorContract {
  return (
    isRecord(value) &&
    value.name === name &&
    value.dtype === "float32" &&
    value.layout === "NCHW" &&
    value.range === "[0,1]" &&
    isExactShape(value.shape)
  );
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
