import type { MeshoptDecoder as MeshoptDecoderValue } from "meshoptimizer";

import {
  parsePackedSceneV2,
  type PackedSceneV2,
  type PackedSceneV2Buffer,
} from "./packed-scene-v2";
import {
  assertRuntimeManifestV2MatchesPack,
  parseResearchCourtyardRuntimeManifestV2,
  type HashedResourceV2,
  type ResearchCourtyardRuntimeManifestV2,
} from "./runtime-manifest-v2";

export type ResearchCourtyardV2Readiness = "loading" | "cpu-payload" | "failed";

export interface ResearchCourtyardV2Fetch {
  (input: string, init?: RequestInit): Promise<Response>;
}

export interface ResearchCourtyardV2LoadOptions {
  baseUrl: string;
  manifest: HashedResourceV2;
  fetch: ResearchCourtyardV2Fetch;
  signal?: AbortSignal;
}

export interface ResearchCourtyardV2Environment {
  basis: string;
  convolution: string;
  coefficients: readonly {
    index: number;
    l: number;
    m: number;
    rgb: readonly [number, number, number];
  }[];
}

export interface ResearchCourtyardV2CpuPayload {
  pack: PackedSceneV2;
  buffers: {
    vertices: ArrayBuffer;
    indices: ArrayBuffer;
    materials: ArrayBuffer;
    instances: ArrayBuffer;
    indirect: ArrayBuffer;
  };
  environment: ResearchCourtyardV2Environment;
  runtimeManifest: ResearchCourtyardRuntimeManifestV2;
  dispose(): void;
}

export interface ResearchCourtyardV2LoadResult {
  readiness: ResearchCourtyardV2Readiness;
  generation: number;
  payload?: ResearchCourtyardV2CpuPayload;
  reason?: string;
}

export class ResearchCourtyardV2LoadError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "ResearchCourtyardV2LoadError";
  }
}

function fail(code: string, message: string): never {
  throw new ResearchCourtyardV2LoadError(code, message);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("json", `${label} must be an object`);
  return value as Record<string, unknown>;
}

function parseJson(bytes: ArrayBuffer, label: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    fail("json", `${label}: ${error instanceof Error ? error.message : "invalid JSON"}`);
  }
}

function resolveWithinBase(baseUrl: string, uri: string): string {
  if (
    !uri ||
    uri.startsWith("/") ||
    uri.includes("\\") ||
    uri.split("/").some((segment) => !segment || segment === "." || segment === "..")
  )
    fail("uri", "resource URI escapes the configured base path");
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const base = new URL(normalizedBase, "https://courtyard.invalid");
  const resolved = new URL(uri, base);
  if (resolved.origin !== base.origin || !resolved.pathname.startsWith(base.pathname))
    fail("uri", "resource URI escapes the configured base path");
  return resolved.href.startsWith("https://courtyard.invalid")
    ? `${resolved.pathname}${resolved.search}`
    : resolved.href;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("The operation was aborted.", "AbortError");
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return (
    signal?.aborted === true ||
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function fetchVerified(
  options: ResearchCourtyardV2LoadOptions,
  resource: HashedResourceV2,
  label: string,
): Promise<ArrayBuffer> {
  throwIfAborted(options.signal);
  const response = await options.fetch(resolveWithinBase(options.baseUrl, resource.uri), {
    signal: options.signal,
  });
  if (!response.ok) fail("fetch", `${label} request failed with ${response.status}`);
  const bytes = await response.arrayBuffer();
  throwIfAborted(options.signal);
  if (bytes.byteLength !== resource.bytes)
    fail("bytes", `${label} byte length does not match its receipt`);
  if ((await sha256(bytes)) !== resource.sha256)
    fail("hash", `${label} SHA-256 does not match its receipt`);
  return bytes;
}

type MeshoptDecoderApi = typeof MeshoptDecoderValue;

async function decodeBuffer(
  encoded: ArrayBuffer,
  descriptor: PackedSceneV2Buffer,
  decoder: MeshoptDecoderApi,
  label: string,
): Promise<ArrayBuffer> {
  const output = new Uint8Array(descriptor.bytes);
  const source = new Uint8Array(encoded);
  try {
    if (descriptor.encoding.mode === "TRIANGLES")
      decoder.decodeIndexBuffer(
        output,
        descriptor.encoding.count,
        descriptor.encoding.stride,
        source,
      );
    else
      decoder.decodeVertexBuffer(
        output,
        descriptor.encoding.count,
        descriptor.encoding.stride,
        source,
      );
  } catch (error) {
    fail("meshopt", `${label}: ${error instanceof Error ? error.message : "decode failed"}`);
  }
  if ((await sha256(output.buffer)) !== descriptor.encoding.decodedSha256)
    fail("meshopt", `${label} decoded SHA-256 does not match Pack v2`);
  return output.buffer;
}

function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    fail("environment", `${label} must be finite`);
  return value;
}

function parseEnvironment(value: unknown): ResearchCourtyardV2Environment {
  const source = object(value, "diffuse SH9");
  if (
    source.format !== "graphics-portfolio-diffuse-irradiance-sh9" ||
    source.version !== 1 ||
    source.specularIbl !== false ||
    source.runtimeHdr !== false
  )
    fail("environment", "diffuse SH9 contract mismatch");
  const diffuse = object(source.diffuseSh, "diffuse SH9 coefficients");
  if (
    typeof diffuse.basis !== "string" ||
    typeof diffuse.convolution !== "string" ||
    !Array.isArray(diffuse.coefficients) ||
    diffuse.coefficients.length !== 9
  )
    fail("environment", "requires one basis, convolution, and nine coefficients");
  const coefficients = diffuse.coefficients.map((entry, index) => {
    const coefficient = object(entry, `diffuse SH9[${index}]`);
    if (
      coefficient.index !== index ||
      !Number.isInteger(coefficient.l) ||
      !Number.isInteger(coefficient.m) ||
      !Array.isArray(coefficient.rgb) ||
      coefficient.rgb.length !== 3
    )
      fail("environment", `coefficient ${index} has an invalid order`);
    return {
      index,
      l: coefficient.l as number,
      m: coefficient.m as number,
      rgb: coefficient.rgb.map((channel, channelIndex) =>
        finite(channel, `coefficient ${index} channel ${channelIndex}`),
      ) as [number, number, number],
    };
  });
  return {
    basis: diffuse.basis,
    convolution: diffuse.convolution,
    coefficients,
  };
}

async function loadPayload(
  options: ResearchCourtyardV2LoadOptions,
): Promise<ResearchCourtyardV2CpuPayload> {
  const runtimeBytes = await fetchVerified(options, options.manifest, "runtime manifest");
  const runtimeManifest = parseResearchCourtyardRuntimeManifestV2(
    parseJson(runtimeBytes, "runtime manifest"),
  );
  const packBytes = await fetchVerified(options, runtimeManifest.pack, "Pack v2");
  const pack = parsePackedSceneV2(parseJson(packBytes, "Pack v2"));
  assertRuntimeManifestV2MatchesPack(runtimeManifest, pack);
  const names = ["vertices", "indices", "materials", "instances", "indirect"] as const;
  const [encodedBuffers, environmentBytes, meshoptimizer] = await Promise.all([
    Promise.all(
      names.map((name) => fetchVerified(options, runtimeManifest.buffers[name], `${name} buffer`)),
    ),
    fetchVerified(options, runtimeManifest.environment.diffuseSh, "diffuse SH9"),
    import("meshoptimizer"),
  ]);
  await meshoptimizer.MeshoptDecoder.ready;
  if (!meshoptimizer.MeshoptDecoder.supported)
    fail("meshopt", "WebAssembly decoder is unavailable");
  const decoded = await Promise.all(
    names.map((name, index) =>
      decodeBuffer(encodedBuffers[index], pack.transport[name], meshoptimizer.MeshoptDecoder, name),
    ),
  );
  const buffers = Object.fromEntries(
    names.map((name, index) => [name, decoded[index]]),
  ) as ResearchCourtyardV2CpuPayload["buffers"];
  const environment = parseEnvironment(parseJson(environmentBytes, "diffuse SH9"));
  let disposed = false;
  return {
    pack,
    buffers,
    environment,
    runtimeManifest,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const name of names) buffers[name] = new ArrayBuffer(0);
    },
  };
}

export class ResearchCourtyardV2Loader {
  private generation = 0;
  private active: ResearchCourtyardV2CpuPayload | undefined;

  async load(options: ResearchCourtyardV2LoadOptions): Promise<ResearchCourtyardV2LoadResult> {
    const generation = ++this.generation;
    this.active?.dispose();
    this.active = undefined;
    try {
      const payload = await loadPayload(options);
      if (generation !== this.generation) {
        payload.dispose();
        return {
          readiness: "failed",
          generation,
          reason: "superseded by a newer load request",
        };
      }
      this.active = payload;
      return { readiness: "cpu-payload", generation, payload };
    } catch (error) {
      if (isAbort(error, options.signal)) throw error;
      return {
        readiness: "failed",
        generation,
        reason: error instanceof Error ? error.message : "Research Courtyard v2 load failed",
      };
    }
  }

  dispose(): void {
    this.generation += 1;
    this.active?.dispose();
    this.active = undefined;
  }
}
