import {
  isPortableResourceUri,
  type PackedSceneV2,
  type PackedSceneV2Buffer,
  type PackedSceneV2Texture,
} from "./packed-scene-v2";

export const RESEARCH_COURTYARD_RUNTIME_MANIFEST_V2 = 2;

export interface HashedResourceV2 {
  uri: string;
  bytes: number;
  sha256: string;
}

export interface ResearchCourtyardRuntimeTextureV2 {
  colorSpace: "srgb" | "linear";
  ktx2: HashedResourceV2;
  webp: HashedResourceV2;
}

export interface ResearchCourtyardRuntimeManifestV2 {
  version: typeof RESEARCH_COURTYARD_RUNTIME_MANIFEST_V2;
  sourceSetSha256: string;
  recipeSha256: string;
  toolchainLockSha256: string;
  pack: HashedResourceV2;
  buffers: {
    vertices: HashedResourceV2;
    indices: HashedResourceV2;
    materials: HashedResourceV2;
    instances: HashedResourceV2;
    indirect: HashedResourceV2;
  };
  textures: Record<string, ResearchCourtyardRuntimeTextureV2>;
  transcoders: {
    ktx: {
      version: "4.4.2";
      script: HashedResourceV2;
      wasm: HashedResourceV2;
    };
  };
  environment: {
    diffuseSh: HashedResourceV2;
    reviewPreview: HashedResourceV2 | null;
    specularIbl: false;
    runtimeHdr: false;
  };
}

export class RuntimeManifestV2ValidationError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = "RuntimeManifestV2ValidationError";
  }
}

function fail(path: string, message: string): never {
  throw new RuntimeManifestV2ValidationError(path, message);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail(path, "must be an object");
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) fail(path, "must be a non-empty string");
  return value;
}

function integer(value: unknown, path: string, min = 0): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min)
    fail(path, `must be an integer >= ${min}`);
  return value;
}

function digest(value: unknown, path: string): string {
  const result = text(value, path);
  if (!/^[a-f0-9]{64}$/.test(result)) fail(path, "must be a lowercase SHA-256 digest");
  return result;
}

function resource(value: unknown, path: string): HashedResourceV2 {
  const source = object(value, path);
  const resourceUri = text(source.uri, `${path}.uri`);
  if (!isPortableResourceUri(resourceUri))
    fail(`${path}.uri`, "must be a portable relative POSIX URI");
  return {
    uri: resourceUri,
    bytes: integer(source.bytes, `${path}.bytes`, 1),
    sha256: digest(source.sha256, `${path}.sha256`),
  };
}

function texture(value: unknown, path: string): ResearchCourtyardRuntimeTextureV2 {
  const source = object(value, path);
  const colorSpace = text(source.colorSpace, `${path}.colorSpace`);
  if (colorSpace !== "srgb" && colorSpace !== "linear")
    fail(`${path}.colorSpace`, "must be srgb or linear");
  return {
    colorSpace,
    ktx2: resource(source.ktx2, `${path}.ktx2`),
    webp: resource(source.webp, `${path}.webp`),
  };
}

/** Strict v2 parser. It does not permit a v1 or an unhashed fallback. */
export function parseResearchCourtyardRuntimeManifestV2(
  value: unknown,
): ResearchCourtyardRuntimeManifestV2 {
  const source = object(value, "runtimeManifest");
  if (integer(source.version, "version", 1) !== RESEARCH_COURTYARD_RUNTIME_MANIFEST_V2)
    fail("version", `must equal ${RESEARCH_COURTYARD_RUNTIME_MANIFEST_V2}`);
  const bufferSource = object(source.buffers, "buffers");
  const textureSource = object(source.textures, "textures");
  const transcoderSource = object(source.transcoders, "transcoders");
  const ktxSource = object(transcoderSource.ktx, "transcoders.ktx");
  const environmentSource = object(source.environment, "environment");
  const textures: Record<string, ResearchCourtyardRuntimeTextureV2> = {};
  Object.entries(textureSource).forEach(([id, value]) => {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) fail(`textures.${id}`, "must use a stable lowercase id");
    textures[id] = texture(value, `textures.${id}`);
  });
  return {
    version: RESEARCH_COURTYARD_RUNTIME_MANIFEST_V2,
    sourceSetSha256: digest(source.sourceSetSha256, "sourceSetSha256"),
    recipeSha256: digest(source.recipeSha256, "recipeSha256"),
    toolchainLockSha256: digest(source.toolchainLockSha256, "toolchainLockSha256"),
    pack: resource(source.pack, "pack"),
    buffers: {
      vertices: resource(bufferSource.vertices, "buffers.vertices"),
      indices: resource(bufferSource.indices, "buffers.indices"),
      materials: resource(bufferSource.materials, "buffers.materials"),
      instances: resource(bufferSource.instances, "buffers.instances"),
      indirect: resource(bufferSource.indirect, "buffers.indirect"),
    },
    textures,
    transcoders: {
      ktx: {
        version:
          ktxSource.version === "4.4.2"
            ? "4.4.2"
            : fail("transcoders.ktx.version", "must equal 4.4.2"),
        script: resource(ktxSource.script, "transcoders.ktx.script"),
        wasm: resource(ktxSource.wasm, "transcoders.ktx.wasm"),
      },
    },
    environment: {
      diffuseSh: resource(environmentSource.diffuseSh, "environment.diffuseSh"),
      reviewPreview:
        environmentSource.reviewPreview === null
          ? null
          : resource(environmentSource.reviewPreview, "environment.reviewPreview"),
      specularIbl:
        environmentSource.specularIbl === false
          ? false
          : fail("environment.specularIbl", "must remain false"),
      runtimeHdr:
        environmentSource.runtimeHdr === false
          ? false
          : fail("environment.runtimeHdr", "must remain false"),
    },
  };
}

function matches(resource: HashedResourceV2, buffer: PackedSceneV2Buffer, path: string): void {
  if (
    resource.uri !== buffer.uri ||
    resource.bytes !== buffer.encoding.encodedBytes ||
    resource.sha256 !== buffer.encoding.encodedSha256
  )
    fail(path, "must match the Pack v2 encoded transport URI, bytes, and hash");
}

function matchesTexture(
  runtime: ResearchCourtyardRuntimeTextureV2,
  pack: PackedSceneV2Texture,
  path: string,
): void {
  if (
    runtime.colorSpace !== pack.colorSpace ||
    runtime.ktx2.uri !== pack.ktx2 ||
    runtime.webp.uri !== pack.webp
  )
    fail(path, "must match the Pack v2 texture record");
}

/** Verifies the hash manifest describes exactly the parsed Pack v2 transport. */
export function assertRuntimeManifestV2MatchesPack(
  manifest: ResearchCourtyardRuntimeManifestV2,
  pack: PackedSceneV2,
): void {
  matches(manifest.buffers.vertices, pack.transport.vertices, "buffers.vertices");
  matches(manifest.buffers.indices, pack.transport.indices, "buffers.indices");
  matches(manifest.buffers.materials, pack.transport.materials, "buffers.materials");
  matches(manifest.buffers.instances, pack.transport.instances, "buffers.instances");
  matches(manifest.buffers.indirect, pack.transport.indirect, "buffers.indirect");
  const ids = new Set(pack.transport.textures.map((entry) => entry.id));
  Object.keys(manifest.textures).forEach((id) => {
    if (!ids.has(id)) fail(`textures.${id}`, "is not declared by Pack v2");
  });
  pack.transport.textures.forEach((entry) => {
    const declared = manifest.textures[entry.id];
    if (!declared) fail(`textures.${entry.id}`, "is missing a hash-bound runtime record");
    matchesTexture(declared, entry, `textures.${entry.id}`);
  });
}
