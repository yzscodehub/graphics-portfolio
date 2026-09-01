import {
  parsePackedScene,
  selectPackedSceneTexture,
  type PackedScene,
  type TextureSelection,
} from "./packed-scene";

export type ResearchCourtyardReadiness =
  "preview-placeholder" | "loading" | "cpu-payload-ktx2" | "cpu-payload-webp" | "failed";

export interface HashedResource {
  uri: string;
  byteLength: number;
  sha256: string;
}

export interface RuntimeTextureSources {
  ktx2?: HashedResource;
  webp?: HashedResource;
}

export interface ResearchCourtyardRuntimeManifest {
  version: 1;
  scene: HashedResource;
  vertices: HashedResource | null;
  indices: HashedResource | null;
  material: HashedResource | null;
  textures: Record<string, RuntimeTextureSources>;
}

export interface ResearchCourtyardFetch {
  (input: string, init?: RequestInit): Promise<Response>;
}

export interface ResearchCourtyardLoadOptions {
  baseUrl: string;
  manifest: HashedResource;
  backend: "webgpu" | "webgl";
  ktx2: boolean;
  fetch: ResearchCourtyardFetch;
  signal?: AbortSignal;
}

export interface LoadedCourtyardTexture {
  id: string;
  selection: TextureSelection;
  bytes: ArrayBuffer;
}

export interface ResearchCourtyardCpuPayload {
  scene: PackedScene;
  vertices: ArrayBuffer;
  indices: ArrayBuffer;
  material: ArrayBuffer;
  textures: readonly LoadedCourtyardTexture[];
  dispose(): void;
}

export interface ResearchCourtyardLoadResult {
  readiness: ResearchCourtyardReadiness;
  generation: number;
  payload?: ResearchCourtyardCpuPayload;
  reason?: string;
}

export interface CleanupScope {
  add(cleanup: () => void | Promise<void>): unknown;
}

export function attachCourtyardPayload(
  scope: CleanupScope,
  payload: ResearchCourtyardCpuPayload,
): void {
  scope.add(() => payload.dispose());
}

export class ResearchCourtyardRuntimeLoader {
  private generation = 0;
  private active: ResearchCourtyardCpuPayload | undefined;

  async load(options: ResearchCourtyardLoadOptions): Promise<ResearchCourtyardLoadResult> {
    const generation = ++this.generation;
    this.active?.dispose();
    this.active = undefined;
    try {
      const manifestBytes = await fetchVerified(options, options.manifest, "runtime manifest");
      const manifest = parseRuntimeManifest(parseJson(manifestBytes, "runtime manifest"));
      const sceneBytes = await fetchVerified(options, manifest.scene, "packed scene");
      const scene = parsePackedScene(parseJson(sceneBytes, "packed scene"));
      if (scene.readiness === "preview-placeholder")
        return { readiness: "preview-placeholder", generation };

      const payload = await loadReviewedPayload(options, scene, manifest);
      if (generation !== this.generation) {
        payload.dispose();
        return { readiness: "failed", generation, reason: "superseded by a newer load request" };
      }
      this.active = payload;
      const usedWebp = payload.textures.some((texture) => texture.selection.kind === "webp");
      return {
        readiness: usedWebp ? "cpu-payload-webp" : "cpu-payload-ktx2",
        generation,
        payload,
      };
    } catch (error) {
      if (isAbort(error, options.signal)) throw error;
      return {
        readiness: "failed",
        generation,
        reason: error instanceof Error ? error.message : "Research Courtyard load failed.",
      };
    }
  }

  dispose(): void {
    this.generation += 1;
    this.active?.dispose();
    this.active = undefined;
  }
}

async function loadReviewedPayload(
  options: ResearchCourtyardLoadOptions,
  scene: PackedScene,
  manifest: ResearchCourtyardRuntimeManifest,
): Promise<ResearchCourtyardCpuPayload> {
  if (!scene.transport.vertices || !scene.transport.indices)
    throw new Error("Reviewed packed scene is missing binary transport.");
  const vertices = requireDescriptor(manifest.vertices, "vertices");
  const indices = requireDescriptor(manifest.indices, "indices");
  const material = requireDescriptor(manifest.material, "material");
  assertTransport(scene.transport.vertices, vertices, "vertices");
  assertTransport(scene.transport.indices, indices, "indices");

  const [vertexBytes, indexBytes, materialBytes] = await Promise.all([
    fetchVerified(options, vertices, "vertices"),
    fetchVerified(options, indices, "indices"),
    fetchVerified(options, material, "material"),
  ]);
  const textures = await Promise.all(
    scene.transport.textures.map((source) => loadTexture(options, source.id, source, manifest)),
  );
  return makePayload(scene, vertexBytes, indexBytes, materialBytes, textures);
}

async function loadTexture(
  options: ResearchCourtyardLoadOptions,
  id: string,
  source: PackedScene["transport"]["textures"][number],
  manifest: ResearchCourtyardRuntimeManifest,
): Promise<LoadedCourtyardTexture> {
  const declared = manifest.textures[id];
  if (!declared) throw new Error("Texture manifest entry is missing for " + id + ".");
  const selection = selectPackedSceneTexture(source, { ktx2: options.ktx2 });
  if (selection.kind === "ktx2") {
    const descriptor = requireDescriptor(declared.ktx2, id + " KTX2");
    assertUri(selection.uri, descriptor.uri, id + " KTX2");
    try {
      return { id, selection, bytes: await fetchVerified(options, descriptor, id + " KTX2") };
    } catch (error) {
      if (isAbort(error, options.signal)) throw error;
      return loadWebp(options, id, source, declared);
    }
  }
  return loadWebp(options, id, source, declared);
}

async function loadWebp(
  options: ResearchCourtyardLoadOptions,
  id: string,
  source: PackedScene["transport"]["textures"][number],
  declared: RuntimeTextureSources,
): Promise<LoadedCourtyardTexture> {
  const selection = selectPackedSceneTexture({ ...source, ktx2: null }, { ktx2: false });
  if (selection.kind !== "webp") throw new Error("No WebP fallback is available for " + id + ".");
  const descriptor = requireDescriptor(declared.webp, id + " WebP");
  assertUri(selection.uri, descriptor.uri, id + " WebP");
  return { id, selection, bytes: await fetchVerified(options, descriptor, id + " WebP") };
}

function makePayload(
  scene: PackedScene,
  vertices: ArrayBuffer,
  indices: ArrayBuffer,
  material: ArrayBuffer,
  textures: LoadedCourtyardTexture[],
): ResearchCourtyardCpuPayload {
  let disposed = false;
  return {
    scene,
    vertices,
    indices,
    material,
    textures,
    dispose() {
      if (disposed) return;
      disposed = true;
      textures.splice(0, textures.length);
    },
  };
}

function parseRuntimeManifest(value: unknown): ResearchCourtyardRuntimeManifest {
  const source = object(value, "runtime manifest");
  if (source.version !== 1) throw new Error("Runtime manifest version must equal one.");
  const textures = object(source.textures ?? {}, "runtime manifest textures");
  const parsedTextures: Record<string, RuntimeTextureSources> = {};
  for (const [id, entry] of Object.entries(textures)) {
    const texture = object(entry, "runtime texture " + id);
    parsedTextures[id] = {
      ktx2: optionalDescriptor(texture.ktx2, "runtime texture " + id + " KTX2"),
      webp: optionalDescriptor(texture.webp, "runtime texture " + id + " WebP"),
    };
  }
  return {
    version: 1,
    scene: descriptor(source.scene, "scene"),
    vertices: optionalDescriptor(source.vertices, "vertices") ?? null,
    indices: optionalDescriptor(source.indices, "indices") ?? null,
    material: optionalDescriptor(source.material, "material") ?? null,
    textures: parsedTextures,
  };
}

async function fetchVerified(
  options: ResearchCourtyardLoadOptions,
  descriptor: HashedResource,
  label: string,
): Promise<ArrayBuffer> {
  throwIfAborted(options.signal);
  const response = await options.fetch(resolveWithinBase(options.baseUrl, descriptor.uri), {
    signal: options.signal,
  });
  if (!response.ok) throw new Error(label + " request failed with " + response.status + ".");
  const bytes = await response.arrayBuffer();
  throwIfAborted(options.signal);
  if (bytes.byteLength !== descriptor.byteLength)
    throw new Error(label + " byte length does not match its descriptor.");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const actual = Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  if (actual !== descriptor.sha256.toLowerCase())
    throw new Error(label + " SHA-256 does not match its descriptor.");
  return bytes;
}

function descriptor(value: unknown, label: string): HashedResource {
  const source = object(value, label);
  const uri = string(source.uri, label + " uri");
  const byteLength = source.byteLength;
  const sha256 = string(source.sha256, label + " SHA-256").toLowerCase();
  if (typeof byteLength !== "number" || !Number.isSafeInteger(byteLength) || byteLength <= 0)
    throw new Error(label + " byte length must be a positive integer.");
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error(label + " SHA-256 must be lowercase hex.");
  resolveWithinBase("/base/", uri);
  return { uri, byteLength, sha256 };
}

function optionalDescriptor(value: unknown, label: string): HashedResource | undefined {
  return value === null || value === undefined ? undefined : descriptor(value, label);
}

function requireDescriptor(
  value: HashedResource | undefined | null,
  label: string,
): HashedResource {
  if (!value) throw new Error("Runtime manifest is missing " + label + ".");
  return value;
}

function assertTransport(
  transport: { uri: string; byteLength: number },
  descriptor: HashedResource,
  label: string,
): void {
  assertUri(transport.uri, descriptor.uri, label);
  if (transport.byteLength !== descriptor.byteLength)
    throw new Error(label + " byte length differs from packed-scene transport.");
}

function assertUri(expected: string, actual: string, label: string): void {
  if (expected !== actual) throw new Error(label + " URI differs from packed-scene transport.");
}

function resolveWithinBase(baseUrl: string, uri: string): string {
  if (
    !uri ||
    uri.startsWith("/") ||
    uri.includes("\\") ||
    uri.split("/").some((segment) => segment === ".." || segment === ".")
  )
    throw new Error("Resource URI escapes the configured base path.");
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";
  const base = new URL(normalizedBase, "https://courtyard.invalid");
  const resolved = new URL(uri, base);
  if (resolved.origin !== base.origin || !resolved.pathname.startsWith(base.pathname))
    throw new Error("Resource URI escapes the configured base path.");
  return resolved.pathname + resolved.search;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(label + " must be an object.");
  return value as Record<string, unknown>;
}

function parseJson(bytes: ArrayBuffer, label: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error(label + " is not valid JSON.");
  }
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(label + " must be a string.");
  return value;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted || (error instanceof DOMException && error.name === "AbortError");
}
