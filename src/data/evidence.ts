export type EvidenceLevel = "verified" | "measured";
export type MetricSource = "gpu-timestamp" | "cpu-frame" | "onnx-runtime" | "offline-evaluation";

export interface EvidenceEnvironment {
  id: string;
  kind: "generated-vector" | "runtime-capture" | "measurement";
  os?: string;
  browser?: string;
  browserVersion?: string;
  viewport?: string;
  navigatorWebGPU?: boolean;
  adapter?: string;
  measurement: string;
}

export interface EvidenceAsset {
  path: string;
  role: "demo-poster" | "project-cover" | "project-architecture" | "demo-runtime-capture";
  owner: "yzscodehub";
  license: "self-authored";
  bytes: number;
  sha256: string;
  width: number;
  height: number;
  environment: string;
  state?: string;
  backend?: string;
}

export interface EvidenceManifest {
  version: 2;
  generatedBy: "scripts/generate-media.mjs";
  environments: EvidenceEnvironment[];
  assets: EvidenceAsset[];
}

export interface MetricSample {
  label: string;
  value: number | string;
  unit?: string;
  source: MetricSource;
}
