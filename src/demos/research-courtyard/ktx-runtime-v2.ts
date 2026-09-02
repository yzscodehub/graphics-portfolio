import type { HashedResourceV2, ResearchCourtyardRuntimeManifestV2 } from "./runtime-manifest-v2";

export type KtxTranscodeKind = "bc7" | "etc2" | "astc";

export interface KtxTranscodeTarget {
  kind: KtxTranscodeKind;
  enumName: "BC7_RGBA" | "ETC2_RGBA" | "ASTC_4x4_RGBA";
  format: GPUTextureFormat;
  blockWidth: 4;
  blockHeight: 4;
  blockBytes: 16;
}

export interface KtxMipLevel {
  level: number;
  width: number;
  height: number;
  bytesPerRow: number;
  rowsPerImage: number;
  data: Uint8Array;
}

export interface TranscodedKtxTexture {
  kind: KtxTranscodeKind;
  format: GPUTextureFormat;
  width: number;
  height: number;
  mipLevelCount: number;
  levels: readonly KtxMipLevel[];
}

interface KtxEnumValue {
  value: number;
}

interface KtxTexture {
  baseWidth: number;
  baseHeight: number;
  needsTranscoding: boolean;
  transcodeBasis(target: KtxEnumValue, flags: number): KtxEnumValue;
  getImage(level: number, layer: number, faceSlice: number): Uint8Array | null;
  delete(): void;
}

export interface KtxReadModule {
  texture: new (bytes: Uint8Array) => KtxTexture;
  ErrorCode: { SUCCESS: KtxEnumValue };
  TranscodeTarget: Record<string, KtxEnumValue>;
}

export class ResearchCourtyardKtxRuntimeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "ResearchCourtyardKtxRuntimeError";
  }
}

function fail(code: string, message: string): never {
  throw new ResearchCourtyardKtxRuntimeError(code, message);
}

function srgbFormat(kind: KtxTranscodeKind, colorSpace: "srgb" | "linear") {
  const suffix = colorSpace === "srgb" ? "-srgb" : "";
  if (kind === "bc7") return `bc7-rgba-unorm${suffix}` as GPUTextureFormat;
  if (kind === "etc2") return `etc2-rgba8unorm${suffix}` as GPUTextureFormat;
  return `astc-4x4-unorm${suffix}` as GPUTextureFormat;
}

export function selectKtxTranscodeTarget(
  features: ReadonlySet<string>,
  colorSpace: "srgb" | "linear",
): KtxTranscodeTarget | null {
  if (features.has("texture-compression-bc"))
    return {
      kind: "bc7",
      enumName: "BC7_RGBA",
      format: srgbFormat("bc7", colorSpace),
      blockWidth: 4,
      blockHeight: 4,
      blockBytes: 16,
    };
  if (features.has("texture-compression-etc2"))
    return {
      kind: "etc2",
      enumName: "ETC2_RGBA",
      format: srgbFormat("etc2", colorSpace),
      blockWidth: 4,
      blockHeight: 4,
      blockBytes: 16,
    };
  if (features.has("texture-compression-astc"))
    return {
      kind: "astc",
      enumName: "ASTC_4x4_RGBA",
      format: srgbFormat("astc", colorSpace),
      blockWidth: 4,
      blockHeight: 4,
      blockBytes: 16,
    };
  return null;
}

function parseKtx2Header(bytes: ArrayBuffer) {
  const data = new Uint8Array(bytes);
  const magic = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
  if (data.byteLength < 80 || magic.some((value, index) => data[index] !== value))
    fail("ktx2", "identifier or header is invalid");
  const header = new DataView(bytes);
  const width = header.getUint32(20, true);
  const height = header.getUint32(24, true);
  const depth = header.getUint32(28, true);
  const layers = header.getUint32(32, true);
  const faces = header.getUint32(36, true);
  const levels = header.getUint32(40, true);
  if (
    width <= 0 ||
    height <= 0 ||
    depth !== 0 ||
    layers !== 0 ||
    faces !== 1 ||
    levels <= 0 ||
    levels > 32
  )
    fail("ktx2", "only finite 2D, one-face, non-array mip chains are supported");
  return { width, height, levels };
}

export function transcodeKtx2(
  bytes: ArrayBuffer,
  module: KtxReadModule,
  target: KtxTranscodeTarget,
): TranscodedKtxTexture {
  const header = parseKtx2Header(bytes);
  const targetEnum = module.TranscodeTarget[target.enumName];
  if (!targetEnum) fail("ktx2", `module does not expose ${target.enumName}`);
  const texture = new module.texture(new Uint8Array(bytes));
  try {
    if (texture.baseWidth !== header.width || texture.baseHeight !== header.height)
      fail("ktx2", "wrapper dimensions differ from the KTX2 header");
    if (texture.needsTranscoding) {
      const result = texture.transcodeBasis(targetEnum, 0);
      if (result?.value !== module.ErrorCode.SUCCESS.value)
        fail("ktx2", `transcode failed with code ${String(result?.value)}`);
    }
    const levels = Array.from({ length: header.levels }, (_, level) => {
      const width = Math.max(1, header.width >> level);
      const height = Math.max(1, header.height >> level);
      const blocksWide = Math.max(1, Math.ceil(width / target.blockWidth));
      const blocksHigh = Math.max(1, Math.ceil(height / target.blockHeight));
      const expectedBytes = blocksWide * blocksHigh * target.blockBytes;
      const view = texture.getImage(level, 0, 0);
      if (!view || view.byteLength !== expectedBytes)
        fail(
          "ktx2",
          `mip ${level} has ${String(view?.byteLength)} bytes, expected ${expectedBytes}`,
        );
      return {
        level,
        width,
        height,
        bytesPerRow: blocksWide * target.blockBytes,
        rowsPerImage: blocksHigh,
        data: new Uint8Array(view).slice(),
      };
    });
    return {
      kind: target.kind,
      format: target.format,
      width: header.width,
      height: header.height,
      mipLevelCount: header.levels,
      levels,
    };
  } finally {
    texture.delete();
  }
}

interface KtxReadFactory {
  (options: { wasmBinary: Uint8Array; locateFile(path: string): string }): Promise<KtxReadModule>;
}

declare global {
  interface Window {
    createKtxReadModule?: KtxReadFactory;
  }
}

export interface RuntimeTextureFetch {
  (input: string, init?: RequestInit): Promise<Response>;
}

function resolveWithinBase(baseUrl: string, uri: string) {
  if (
    !uri ||
    uri.startsWith("/") ||
    uri.includes("\\") ||
    uri.split("/").some((segment) => !segment || segment === "." || segment === "..")
  )
    fail("uri", "resource URI escapes the configured base path");
  const base = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const resolved = new URL(uri, base);
  if (resolved.origin !== base.origin || !resolved.pathname.startsWith(base.pathname))
    fail("uri", "resource URI escapes the configured base path");
  return resolved.href;
}

async function hash(bytes: ArrayBuffer) {
  const result = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(result), (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function fetchVerified(
  baseUrl: string,
  resource: HashedResourceV2,
  fetch: RuntimeTextureFetch,
  signal?: AbortSignal,
) {
  const response = await fetch(resolveWithinBase(baseUrl, resource.uri), { signal });
  if (!response.ok) fail("fetch", `${resource.uri} returned ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== resource.bytes || (await hash(bytes)) !== resource.sha256)
    fail("hash", `${resource.uri} does not match its receipt`);
  return bytes;
}

function hexToSri(hex: string) {
  const bytes = Uint8Array.from({ length: hex.length / 2 }, (_, index) =>
    Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16),
  );
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `sha256-${btoa(binary)}`;
}

async function defaultLoadScript(url: string, integrity: string) {
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.integrity = integrity;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("libktx script failed integrity or network validation")),
      { once: true },
    );
    document.head.append(script);
  });
}

export class KtxReadModuleLoader {
  private active:
    | {
        identity: string;
        promise: Promise<KtxReadModule>;
      }
    | undefined;

  constructor(
    private readonly loadScript: (
      url: string,
      integrity: string,
    ) => Promise<void> = defaultLoadScript,
    private readonly factory?: KtxReadFactory,
  ) {}

  load(options: {
    baseUrl: string;
    runtime: ResearchCourtyardRuntimeManifestV2;
    fetch: RuntimeTextureFetch;
    signal?: AbortSignal;
  }): Promise<KtxReadModule> {
    const support = options.runtime.transcoders.ktx;
    const identity = `${support.script.sha256}:${support.wasm.sha256}`;
    if (this.active?.identity === identity) return this.active.promise;
    const promise = this.loadFresh(options).catch((error) => {
      if (this.active?.promise === promise) this.active = undefined;
      throw error;
    });
    this.active = { identity, promise };
    return promise;
  }

  private async loadFresh(options: {
    baseUrl: string;
    runtime: ResearchCourtyardRuntimeManifestV2;
    fetch: RuntimeTextureFetch;
    signal?: AbortSignal;
  }) {
    const support = options.runtime.transcoders.ktx;
    const wasm = await fetchVerified(options.baseUrl, support.wasm, options.fetch, options.signal);
    const scriptUrl = resolveWithinBase(options.baseUrl, support.script.uri);
    const factory = this.factory;
    if (!factory) await this.loadScript(scriptUrl, hexToSri(support.script.sha256));
    const create = factory ?? window.createKtxReadModule;
    if (!create) fail("libktx", "verified script did not expose createKtxReadModule");
    const module = await create({
      wasmBinary: new Uint8Array(wasm),
      locateFile: () => resolveWithinBase(options.baseUrl, support.wasm.uri),
    });
    if (!module?.texture || !module.TranscodeTarget || !module.ErrorCode)
      fail("libktx", "module API does not match KTX-Software 4.4.2");
    return module;
  }
}

export type LoadedRuntimeTexture =
  | {
      id: string;
      kind: "ktx2";
      texture: TranscodedKtxTexture;
      dispose(): void;
    }
  | {
      id: string;
      kind: "webp";
      bitmap: ImageBitmap;
      format: GPUTextureFormat;
      dispose(): void;
    };

export async function loadRuntimeTexture(
  id: string,
  options: {
    baseUrl: string;
    runtime: ResearchCourtyardRuntimeManifestV2;
    deviceFeatures: ReadonlySet<string>;
    fetch: RuntimeTextureFetch;
    moduleLoader: KtxReadModuleLoader;
    createImageBitmap: typeof globalThis.createImageBitmap;
    signal?: AbortSignal;
  },
): Promise<LoadedRuntimeTexture> {
  const record = options.runtime.textures[id];
  if (!record) fail("texture", `${id} is absent from the runtime manifest`);
  const target = selectKtxTranscodeTarget(options.deviceFeatures, record.colorSpace);
  if (target)
    try {
      const [data, module] = await Promise.all([
        fetchVerified(options.baseUrl, record.ktx2, options.fetch, options.signal),
        options.moduleLoader.load(options),
      ]);
      const texture = transcodeKtx2(data, module, target);
      return {
        id,
        kind: "ktx2",
        texture,
        dispose() {
          for (const level of texture.levels) level.data = new Uint8Array();
        },
      };
    } catch (error) {
      if (options.signal?.aborted) throw error;
    }
  const bytes = await fetchVerified(options.baseUrl, record.webp, options.fetch, options.signal);
  const bitmap = await options.createImageBitmap(new Blob([bytes], { type: "image/webp" }), {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
  });
  if (bitmap.width <= 0 || bitmap.height <= 0) {
    bitmap.close();
    fail("webp", `${id} decoded to an empty bitmap`);
  }
  return {
    id,
    kind: "webp",
    bitmap,
    format: record.colorSpace === "srgb" ? "rgba8unorm-srgb" : "rgba8unorm",
    dispose() {
      bitmap.close();
    },
  };
}
