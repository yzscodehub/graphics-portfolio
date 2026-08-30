export type DemoBackend =
  "three-webgpu" | "three-webgl" | "raw-webgpu" | "svg" | "onnx-web" | "canvas-2d";

export type DemoCapability = "webgpu" | "webgl2" | "wasm";
export type DemoQuality = "auto" | "low" | "high";

export interface DemoDefinition {
  slug: string;
  backend: DemoBackend;
  capabilities: DemoCapability[];
  fallbackImage?: string;
  fallbackVideo?: string;
  relatedProjects: string[];
}

export interface DemoMetrics {
  fps?: number;
  frameTimeMs?: number;
  inferenceMs?: number;
  samples?: number;
  backend?: string;
  status?: string;
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
