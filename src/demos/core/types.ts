import type { CapabilitySnapshot } from "./capabilities";

export type DemoBackend =
  "three-webgpu" | "three-webgl" | "raw-webgpu" | "svg" | "onnx-web" | "canvas-2d";

export type DemoCapability = "webgpu" | "webgl2" | "wasm";
export type DemoQuality = "auto" | "low" | "high";
export type EvidenceLevel = "verified" | "measured";
export type MetricSource =
  | "animation-frame"
  | "cpu-wall-clock"
  | "gpu-timestamp-query"
  | "inference-end-to-end"
  | "unavailable";

export type Cleanup = () => void | Promise<void>;

export interface GpuResourceLike {
  destroy?(): void;
}

export interface InferenceSessionLike {
  release(): void | Promise<void>;
}

export interface DeviceLostLike {
  lost?: Promise<unknown>;
}

export interface DemoResourceScope {
  readonly signal: AbortSignal;
  add(cleanup: Cleanup): () => void;
  on(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ): () => void;
  requestAnimationFrame(callback: FrameRequestCallback): number | undefined;
  trackAnimationFrame(handle: number): number;
  trackGpuResource<T extends GpuResourceLike>(resource: T): T;
  trackInferenceSession<T extends InferenceSessionLike>(session: T): T;
  onDeviceLost(device: DeviceLostLike, recover: (reason: unknown) => void | Promise<void>): void;
}

export interface DemoDefinition {
  slug: string;
  maturity: "completed";
  evidence: EvidenceLevel;
  backend: DemoBackend;
  backends: DemoBackend[];
  capabilities: DemoCapability[];
  requirements: string[];
  fallbackImage: string;
  fallbackVideo?: string;
  relatedProjects: string[];
  relatedArticles: string[];
  metricSources: MetricSource[];
}

export interface DemoMetrics {
  fps?: number;
  frameTimeMs?: number;
  inferenceMs?: number;
  compileMs?: number;
  samples?: number;
  backend?: string;
  status?: string;
  metricSource?: MetricSource;
}

export interface DemoContext {
  canvas: HTMLCanvasElement;
  stage: HTMLElement;
  controls: HTMLElement;
  metrics: HTMLElement;
  signal: AbortSignal;
  quality: DemoQuality;
  setMetrics(metrics: DemoMetrics): void;
  setStatus(message: string, tone?: "info" | "success" | "warning" | "error"): void;
  addCleanup(cleanup: () => void): void;
  resources?: DemoResourceScope;
  onDeviceLost?: (
    device: DeviceLostLike,
    recover: (reason: unknown) => void | Promise<void>,
  ) => void;
  capabilities?: CapabilitySnapshot;
  generation?: number;
  isCurrent?(): boolean;
}

export interface DemoController {
  init(context: DemoContext): Promise<void>;
  resize(width: number, height: number): void;
  pause(): void;
  resume(): void;
  dispose(): Promise<void> | void;
}

export type DemoFactory = () => DemoController;

export interface DemoLoader {
  definition: DemoDefinition;
  load(): Promise<{ createDemo: DemoFactory }>;
}
