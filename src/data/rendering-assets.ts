import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type RenderingAssetKind = "scene" | "mesh" | "texture" | "hdri" | "neural-data";
export type RenderingAssetLicense = "self-authored" | "CC0";

export interface RenderingAssetRecord {
  id: string;
  kind: RenderingAssetKind;
  role: string;
  path: string;
  sourceUrl: string | null;
  authors: string[];
  license: RenderingAssetLicense;
  sourceSha256: string | null;
  outputSha256: string;
  bytes: number;
  triangles?: number;
  lodTriangles?: number[];
  usedBy: string[];
  plannedFor?: string[];
}

export interface RenderingAssetBudget {
  publicRenderingBytes: number;
  demoInitialBytes: number;
  heroBytes: number;
  courtyardGeometryBytes: number;
  ktx2Bytes: number;
  webpFallbackBytes: number;
}

export interface RenderingAssetManifest {
  version: 1;
  status: "preview-placeholder" | "reviewed";
  generatedBy: string;
  sourceLock: string;
  budget: RenderingAssetBudget;
  assets: RenderingAssetRecord[];
}

export interface RenderingSourceRecord {
  id: string;
  kind: Extract<RenderingAssetKind, "mesh" | "texture" | "hdri">;
  page: string;
  sourceUrl: string;
  license: "CC0";
  authors: string[];
  api: {
    infoUrl: string;
    filesUrl: string;
    filesHash: string | null;
    queriedAt: string;
  };
  selection: Record<string, unknown>;
  files: RenderingSourceFileRecord[];
  usedBy: string[];
}

export interface RenderingSourceFileRecord {
  role: string;
  relativePath: string;
  directUrl: string;
  bytes: number;
  md5: string;
  sha256: string | null;
  status: "metadata-locked" | "reviewed";
  cachePath: string;
}

export interface RenderingSourceLock {
  version: 3;
  policy: {
    license: "CC0";
    stage: "metadata-locked" | "sources-reviewed" | "integrated";
    rawCache: string;
    disallowedExtensions: string[];
  };
  sourceSetSha256: string;
  review?: {
    reviewId: string;
    evidencePath: string;
    evidenceSha256: string;
    reviewer: string;
    reviewedAt: string;
  };
  integration?: {
    recipeSha256: string;
    toolchainLockSha256: string;
    runtimeManifestPath: string;
    runtimeManifestSha256: string;
  };
  sources: RenderingSourceRecord[];
}

function resolveProjectFile(relativePath: string): string {
  let directory = process.cwd();
  while (true) {
    const candidate = path.resolve(directory, relativePath);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(`Unable to resolve project asset file: ${relativePath}`);
}

function readManifest<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolveProjectFile(relativePath), "utf8")) as T;
}

export const renderingAssetManifest = readManifest<RenderingAssetManifest>(
  "public/assets/rendering/manifest.json",
);
export const renderingSourceLock = readManifest<RenderingSourceLock>(
  "public/assets/rendering/sources.lock.json",
);

export const renderingAssets = renderingAssetManifest.assets;
export const plannedRenderingSources = renderingSourceLock.sources.map((source) => ({
  ...source,
  status: renderingSourceLock.policy.stage,
  sourceFileCount: source.files.length,
  sourceBytes: source.files.reduce((total, file) => total + file.bytes, 0),
}));

export function formatAssetBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
}
