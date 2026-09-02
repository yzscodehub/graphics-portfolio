/** Isolated reviewed binary contract; never changes the v1 preview path. */
export const PACKED_SCENE_V2_FORMAT = "graphics-portfolio-packed-scene";
export const PACKED_SCENE_V2_VERSION = 2;
export const PACKED_SCENE_V2_COORDINATE_SYSTEM = "right-handed-y-up-meters";
export const PACKED_SCENE_V2_VERTEX_STRIDE_BYTES = 32;
export const PACKED_SCENE_V2_MATERIAL_STRIDE_BYTES = 64;
export const PACKED_SCENE_V2_INSTANCE_STRIDE_BYTES = 128;
export const PACKED_SCENE_V2_INDEXED_INDIRECT_STRIDE_BYTES = 32;
export const PACKED_SCENE_V2_NO_TEXTURE = 0xffffffff;

export type PackedSceneV2RenderPass = "deferredOpaque" | "alphaMaskForward";
export type PackedSceneV2AlphaMode = "OPAQUE" | "MASK";
export type PackedSceneV2TextureColorSpace = "srgb" | "linear";
export type Matrix3x4 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
export type WorldSphere = readonly [number, number, number, number];

export interface PackedSceneV2Buffer {
  uri: string;
  bytes: number;
}

export interface PackedSceneV2Texture {
  id: string;
  colorSpace: PackedSceneV2TextureColorSpace;
  ktx2: string;
  webp: string;
}

export interface PackedSceneV2Lod {
  state: "draw" | "culled";
  baseVertex: number;
  firstIndex: number;
  indexCount: number;
  vertexCount: number;
  relativeError: number;
  indirectByteOffset: number;
  instanceOffset: number;
  instanceCount: number;
}

export interface PackedSceneV2Mesh {
  id: string;
  lodPolicy: "simplified" | "preserved" | "mixed" | "culled-at-lod2";
  lods: readonly [PackedSceneV2Lod, PackedSceneV2Lod, PackedSceneV2Lod];
}

export interface PackedSceneV2Material {
  id: string;
  role: "default" | "fence";
  alphaMode: PackedSceneV2AlphaMode;
  doubleSided: boolean;
  baseColor: readonly [number, number, number, number];
  emissive: readonly [number, number, number];
  metallic: number;
  roughness: number;
  alphaCutoff: number;
  normalScale: number;
  textureIndices: { baseColor: number; normal: number; orm: number };
  flags: number;
}

export interface PackedSceneV2Instance {
  id: string;
  currentTransform: Matrix3x4;
  previousTransform: Matrix3x4;
  materialIndex: number;
  meshIndex: number;
  flags: number;
  worldSphere: WorldSphere;
  animation: null | {
    kind: "spin-y";
    radiansPerSecond: number;
    phaseRadians: number;
  };
}

export interface PackedSceneV2Transport {
  vertices: PackedSceneV2Buffer;
  indices: PackedSceneV2Buffer;
  materials: PackedSceneV2Buffer;
  instances: PackedSceneV2Buffer;
  indirect: PackedSceneV2Buffer;
  textures: readonly PackedSceneV2Texture[];
}

export interface PackedSceneV2 {
  format: typeof PACKED_SCENE_V2_FORMAT;
  version: typeof PACKED_SCENE_V2_VERSION;
  placeholder: false;
  coordinateSystem: typeof PACKED_SCENE_V2_COORDINATE_SYSTEM;
  indexFormat: "uint32";
  meshes: readonly PackedSceneV2Mesh[];
  materials: readonly PackedSceneV2Material[];
  instances: readonly PackedSceneV2Instance[];
  renderPasses: Record<PackedSceneV2RenderPass, readonly number[]>;
  transport: PackedSceneV2Transport;
}

export class PackedSceneV2ValidationError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = "PackedSceneV2ValidationError";
  }
}

export interface PackedSceneV2LayoutAttribute {
  semantic: string;
  format: string;
  offsetBytes: number;
}

export const PACKED_SCENE_V2_VERTEX_LAYOUT: readonly PackedSceneV2LayoutAttribute[] = [
  { semantic: "POSITION", format: "float32x3", offsetBytes: 0 },
  { semantic: "NORMAL_OCT", format: "snorm16x2", offsetBytes: 12 },
  { semantic: "TANGENT", format: "snorm16x4", offsetBytes: 16 },
  { semantic: "TEXCOORD_0", format: "float16x2", offsetBytes: 24 },
  { semantic: "PADDING", format: "uint32", offsetBytes: 28 },
];

export const PACKED_SCENE_V2_MATERIAL_LAYOUT: readonly PackedSceneV2LayoutAttribute[] = [
  { semantic: "BASE_COLOR", format: "float32x4", offsetBytes: 0 },
  { semantic: "EMISSIVE", format: "float32x3", offsetBytes: 16 },
  { semantic: "METALLIC", format: "float32", offsetBytes: 28 },
  { semantic: "ROUGHNESS", format: "float32", offsetBytes: 32 },
  { semantic: "ALPHA_CUTOFF", format: "float32", offsetBytes: 36 },
  { semantic: "NORMAL_SCALE", format: "float32", offsetBytes: 40 },
  { semantic: "FLAGS", format: "uint32", offsetBytes: 44 },
  { semantic: "BASE_COLOR_TEXTURE", format: "uint32", offsetBytes: 48 },
  { semantic: "NORMAL_TEXTURE", format: "uint32", offsetBytes: 52 },
  { semantic: "ORM_TEXTURE", format: "uint32", offsetBytes: 56 },
  { semantic: "PADDING", format: "uint32", offsetBytes: 60 },
];

export const PACKED_SCENE_V2_INSTANCE_LAYOUT: readonly PackedSceneV2LayoutAttribute[] = [
  { semantic: "CURRENT_TRANSFORM", format: "float32x12", offsetBytes: 0 },
  { semantic: "PREVIOUS_TRANSFORM", format: "float32x12", offsetBytes: 48 },
  { semantic: "MATERIAL_INDEX", format: "uint32", offsetBytes: 96 },
  { semantic: "MESH_INDEX", format: "uint32", offsetBytes: 100 },
  { semantic: "FLAGS", format: "uint32", offsetBytes: 104 },
  { semantic: "WORLD_SPHERE", format: "float32x4", offsetBytes: 108 },
  { semantic: "PADDING", format: "uint32", offsetBytes: 124 },
];

export const PACKED_SCENE_V2_INDEXED_INDIRECT_LAYOUT: readonly PackedSceneV2LayoutAttribute[] = [
  { semantic: "INDEX_COUNT", format: "uint32", offsetBytes: 0 },
  { semantic: "INSTANCE_COUNT", format: "uint32", offsetBytes: 4 },
  { semantic: "FIRST_INDEX", format: "uint32", offsetBytes: 8 },
  { semantic: "BASE_VERTEX", format: "sint32", offsetBytes: 12 },
  { semantic: "FIRST_INSTANCE", format: "uint32", offsetBytes: 16 },
  { semantic: "PADDING", format: "uint32x3", offsetBytes: 20 },
];

const MASK_FLAG = 1;
const DOUBLE_SIDED_FLAG = 2;

function fail(path: string, message: string): never {
  throw new PackedSceneV2ValidationError(path, message);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail(path, "must be an object");
  return value as Record<string, unknown>;
}

function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "must be an array");
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) fail(path, "must be a non-empty string");
  return value;
}

function integer(value: unknown, path: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max)
    fail(path, "must be an integer in range");
  return value;
}

function finite(
  value: unknown,
  path: string,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    fail(path, "must be finite and in range");
  return value;
}

function tuple(value: unknown, path: string, length: number): readonly number[] {
  const values = list(value, path);
  if (values.length !== length) fail(path, `must have exactly ${length} values`);
  return values.map((entry, index) => finite(entry, `${path}[${index}]`));
}

/** True only for a relative POSIX asset URI with no traversal or URL syntax. */
export function isPortableResourceUri(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

function uri(value: unknown, path: string): string {
  if (!isPortableResourceUri(value)) fail(path, "must be a portable relative POSIX URI");
  return value;
}

function exactLayout(
  value: unknown,
  path: string,
  stride: number,
  expected: readonly PackedSceneV2LayoutAttribute[],
): void {
  const source = object(value, path);
  if (integer(source.strideBytes, `${path}.strideBytes`, 1) !== stride)
    fail(`${path}.strideBytes`, `must equal ${stride}`);
  const actual = list(source.attributes, `${path}.attributes`);
  if (actual.length !== expected.length)
    fail(`${path}.attributes`, "does not match the fixed layout");
  actual.forEach((entry, index) => {
    const item = object(entry, `${path}.attributes[${index}]`);
    const wanted = expected[index];
    if (
      text(item.semantic, `${path}.attributes[${index}].semantic`) !== wanted.semantic ||
      text(item.format, `${path}.attributes[${index}].format`) !== wanted.format ||
      integer(item.offsetBytes, `${path}.attributes[${index}].offsetBytes`) !== wanted.offsetBytes
    )
      fail(`${path}.attributes[${index}]`, "does not match the fixed layout");
  });
}

function buffer(value: unknown, path: string): PackedSceneV2Buffer {
  const source = object(value, path);
  return {
    uri: uri(source.uri, `${path}.uri`),
    bytes: integer(source.bytes, `${path}.bytes`, 1),
  };
}

function parseTransport(value: unknown): PackedSceneV2Transport {
  const source = object(value, "transport");
  const textures = list(source.textures, "transport.textures").map((entry, index) => {
    const path = `transport.textures[${index}]`;
    const item = object(entry, path);
    const colorSpace = text(item.colorSpace, `${path}.colorSpace`);
    if (colorSpace !== "srgb" && colorSpace !== "linear")
      fail(`${path}.colorSpace`, "must be srgb or linear");
    const id = text(item.id, `${path}.id`);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) fail(`${path}.id`, "must use a stable lowercase id");
    return {
      id,
      colorSpace,
      ktx2: uri(item.ktx2, `${path}.ktx2`),
      webp: uri(item.webp, `${path}.webp`),
    } as PackedSceneV2Texture;
  });
  if (new Set(textures.map((texture) => texture.id)).size !== textures.length)
    fail("transport.textures", "ids must be unique");
  const parsed = {
    vertices: buffer(source.vertices, "transport.vertices"),
    indices: buffer(source.indices, "transport.indices"),
    materials: buffer(source.materials, "transport.materials"),
    instances: buffer(source.instances, "transport.instances"),
    indirect: buffer(source.indirect, "transport.indirect"),
    textures,
  };
  const resourceUris = [
    parsed.vertices.uri,
    parsed.indices.uri,
    parsed.materials.uri,
    parsed.instances.uri,
    parsed.indirect.uri,
    ...parsed.textures.flatMap((texture) => [texture.ktx2, texture.webp]),
  ];
  if (new Set(resourceUris).size !== resourceUris.length)
    fail("transport", "resource URIs must be unique");
  return parsed;
}

function parseMeshes(value: unknown): PackedSceneV2Mesh[] {
  const ids = new Set<string>();
  return list(value, "meshes").map((entry, index) => {
    const path = `meshes[${index}]`;
    const source = object(entry, path);
    const id = text(source.id, `${path}.id`);
    if (ids.has(id)) fail(`${path}.id`, "must be unique");
    ids.add(id);
    const lodPolicy = text(source.lodPolicy, `${path}.lodPolicy`);
    if (
      lodPolicy !== "simplified" &&
      lodPolicy !== "preserved" &&
      lodPolicy !== "mixed" &&
      lodPolicy !== "culled-at-lod2"
    )
      fail(`${path}.lodPolicy`, "must be simplified, preserved, mixed, or culled-at-lod2");
    const entries = list(source.lods, `${path}.lods`);
    if (entries.length !== 3) fail(`${path}.lods`, "must contain LOD0, LOD1, and LOD2");
    const parsed = entries.map((lod, lodIndex) => {
      const lodPath = `${path}.lods[${lodIndex}]`;
      const item = object(lod, lodPath);
      const state = text(item.state, `${lodPath}.state`);
      if (state !== "draw" && state !== "culled")
        fail(`${lodPath}.state`, "must be draw or culled");
      const indexCount = integer(item.indexCount, `${lodPath}.indexCount`);
      if (indexCount % 3 !== 0) fail(`${lodPath}.indexCount`, "must be triangle aligned");
      const parsedLod: PackedSceneV2Lod = {
        state,
        baseVertex: integer(item.baseVertex, `${lodPath}.baseVertex`),
        firstIndex: integer(item.firstIndex, `${lodPath}.firstIndex`),
        indexCount,
        vertexCount: integer(item.vertexCount, `${lodPath}.vertexCount`),
        relativeError: finite(item.relativeError, `${lodPath}.relativeError`, 0),
        indirectByteOffset: integer(item.indirectByteOffset, `${lodPath}.indirectByteOffset`),
        instanceOffset: integer(item.instanceOffset, `${lodPath}.instanceOffset`),
        instanceCount: integer(item.instanceCount, `${lodPath}.instanceCount`),
      };
      if (state === "draw") {
        if (parsedLod.indexCount < 3 || parsedLod.vertexCount < 3 || parsedLod.instanceCount < 1)
          fail(lodPath, "draw LODs require geometry and at least one instance");
      } else if (
        parsedLod.indexCount !== 0 ||
        parsedLod.vertexCount !== 0 ||
        parsedLod.instanceCount !== 0
      )
        fail(lodPath, "culled LODs must have zero geometry and instance count");
      return parsedLod;
    }) as [PackedSceneV2Lod, PackedSceneV2Lod, PackedSceneV2Lod];
    const [lod0, lod1, lod2] = parsed;
    if (lodPolicy === "simplified") {
      if (parsed.some((lod) => lod.state !== "draw"))
        fail(`${path}.lods`, "simplified LODs must all be draw states");
      if (lod0.indexCount <= lod1.indexCount || lod1.indexCount <= lod2.indexCount)
        fail(`${path}.lods`, "must use real, strictly decreasing LOD index counts");
      if (lod0.vertexCount < lod1.vertexCount || lod1.vertexCount < lod2.vertexCount)
        fail(`${path}.lods`, "must have non-increasing vertex counts");
      if (lod0.relativeError >= lod1.relativeError || lod1.relativeError >= lod2.relativeError)
        fail(`${path}.lods`, "must have strictly increasing relative error");
    } else if (lodPolicy === "preserved") {
      if (
        parsed.some((lod) => lod.state !== "draw") ||
        lod0.indexCount !== lod1.indexCount ||
        lod1.indexCount !== lod2.indexCount ||
        lod0.vertexCount !== lod1.vertexCount ||
        lod1.vertexCount !== lod2.vertexCount ||
        parsed.some((lod) => lod.relativeError !== 0)
      )
        fail(`${path}.lods`, "preserved LODs must retain identical geometry and zero error");
    } else if (lodPolicy === "mixed") {
      if (
        parsed.some((lod) => lod.state !== "draw") ||
        lod0.indexCount < lod1.indexCount ||
        lod1.indexCount < lod2.indexCount ||
        lod0.vertexCount < lod1.vertexCount ||
        lod1.vertexCount < lod2.vertexCount ||
        lod0.relativeError > lod1.relativeError ||
        lod1.relativeError > lod2.relativeError ||
        (lod0.indexCount === lod1.indexCount &&
          lod1.indexCount === lod2.indexCount &&
          lod0.vertexCount === lod1.vertexCount &&
          lod1.vertexCount === lod2.vertexCount)
      )
        fail(
          `${path}.lods`,
          "mixed LODs must draw non-increasing geometry with at least one reduction",
        );
    } else if (
      lod0.state !== "draw" ||
      lod1.state !== "draw" ||
      lod2.state !== "culled" ||
      lod0.indexCount < lod1.indexCount ||
      lod0.vertexCount < lod1.vertexCount ||
      lod0.relativeError > lod1.relativeError ||
      lod2.relativeError < lod1.relativeError
    )
      fail(`${path}.lods`, "culled-at-lod2 requires draw/draw/culled with non-increasing geometry");
    return { id, lodPolicy, lods: parsed };
  });
}

function textureIndex(value: unknown, path: string, textureCount: number): number {
  const index = integer(value, path, 0, PACKED_SCENE_V2_NO_TEXTURE);
  if (index !== PACKED_SCENE_V2_NO_TEXTURE && index >= textureCount)
    fail(path, "must reference a declared texture or use NO_TEXTURE");
  return index;
}

function parseMaterials(value: unknown, textureCount: number): PackedSceneV2Material[] {
  const ids = new Set<string>();
  return list(value, "materials").map((entry, index) => {
    const path = `materials[${index}]`;
    const source = object(entry, path);
    const id = text(source.id, `${path}.id`);
    if (ids.has(id)) fail(`${path}.id`, "must be unique");
    ids.add(id);
    const role = text(source.role, `${path}.role`);
    if (role !== "default" && role !== "fence") fail(`${path}.role`, "must be default or fence");
    const alphaMode = text(source.alphaMode, `${path}.alphaMode`);
    if (alphaMode !== "OPAQUE" && alphaMode !== "MASK")
      fail(`${path}.alphaMode`, "must be OPAQUE or MASK");
    if (typeof source.doubleSided !== "boolean") fail(`${path}.doubleSided`, "must be boolean");
    const textureIndices = object(source.textureIndices, `${path}.textureIndices`);
    const flags = integer(source.flags, `${path}.flags`, 0, 3);
    const expectedFlags =
      (alphaMode === "MASK" ? MASK_FLAG : 0) | (source.doubleSided ? DOUBLE_SIDED_FLAG : 0);
    if (flags !== expectedFlags) fail(`${path}.flags`, "must match alphaMode and doubleSided");
    const material: PackedSceneV2Material = {
      id,
      role,
      alphaMode,
      doubleSided: source.doubleSided,
      baseColor: tuple(
        source.baseColor,
        `${path}.baseColor`,
        4,
      ) as PackedSceneV2Material["baseColor"],
      emissive: tuple(source.emissive, `${path}.emissive`, 3) as PackedSceneV2Material["emissive"],
      metallic: finite(source.metallic, `${path}.metallic`, 0, 1),
      roughness: finite(source.roughness, `${path}.roughness`, 0, 1),
      alphaCutoff: finite(source.alphaCutoff, `${path}.alphaCutoff`, 0, 1),
      normalScale: finite(source.normalScale, `${path}.normalScale`, 0),
      textureIndices: {
        baseColor: textureIndex(
          textureIndices.baseColor,
          `${path}.textureIndices.baseColor`,
          textureCount,
        ),
        normal: textureIndex(textureIndices.normal, `${path}.textureIndices.normal`, textureCount),
        orm: textureIndex(textureIndices.orm, `${path}.textureIndices.orm`, textureCount),
      },
      flags,
    };
    if (
      material.role === "fence" &&
      (!material.doubleSided || material.alphaMode !== "MASK" || material.alphaCutoff !== 0.5)
    )
      fail(path, "fence must be MASK, double-sided, and use alphaCutoff 0.5");
    return material;
  });
}

function parseInstances(
  value: unknown,
  meshCount: number,
  materialCount: number,
): PackedSceneV2Instance[] {
  const ids = new Set<string>();
  return list(value, "instances").map((entry, index) => {
    const path = `instances[${index}]`;
    const source = object(entry, path);
    const id = text(source.id, `${path}.id`);
    if (!/^[a-z0-9][a-z0-9:/-]*$/.test(id) || ids.has(id))
      fail(`${path}.id`, "must be safe and unique");
    ids.add(id);
    const sphere = tuple(source.worldSphere, `${path}.worldSphere`, 4) as WorldSphere;
    if (sphere[3] <= 0) fail(`${path}.worldSphere[3]`, "radius must be > 0");
    const flags = integer(source.flags, `${path}.flags`, 0, 0xffffffff);
    let animation: PackedSceneV2Instance["animation"] = null;
    if (source.animation !== null) {
      const value = object(source.animation, `${path}.animation`);
      if (text(value.kind, `${path}.animation.kind`) !== "spin-y")
        fail(`${path}.animation.kind`, "must be spin-y");
      animation = {
        kind: "spin-y",
        radiansPerSecond: finite(value.radiansPerSecond, `${path}.animation.radiansPerSecond`),
        phaseRadians: finite(value.phaseRadians, `${path}.animation.phaseRadians`),
      };
      if (animation.radiansPerSecond === 0)
        fail(`${path}.animation.radiansPerSecond`, "must be non-zero");
    }
    if (((flags & 1) !== 0) !== (animation !== null))
      fail(`${path}.flags`, "bit 0 must identify animated instances");
    return {
      id,
      currentTransform: tuple(source.currentTransform, `${path}.currentTransform`, 12) as Matrix3x4,
      previousTransform: tuple(
        source.previousTransform,
        `${path}.previousTransform`,
        12,
      ) as Matrix3x4,
      materialIndex: integer(source.materialIndex, `${path}.materialIndex`, 0, materialCount - 1),
      meshIndex: integer(source.meshIndex, `${path}.meshIndex`, 0, meshCount - 1),
      flags,
      worldSphere: sphere,
      animation,
    };
  });
}

function parsePasses(value: unknown, instanceCount: number): PackedSceneV2["renderPasses"] {
  const source = object(value, "renderPasses");
  const parse = (entry: unknown, path: string) => {
    const result = list(entry, path).map((item, index) =>
      integer(item, `${path}[${index}]`, 0, instanceCount - 1),
    );
    if (new Set(result).size !== result.length) fail(path, "must not repeat instance indices");
    return result;
  };
  const deferredOpaque = parse(source.deferredOpaque, "renderPasses.deferredOpaque");
  const alphaMaskForward = parse(source.alphaMaskForward, "renderPasses.alphaMaskForward");
  const assigned = new Set([...deferredOpaque, ...alphaMaskForward]);
  if (assigned.size !== deferredOpaque.length + alphaMaskForward.length)
    fail("renderPasses", "must not assign an instance to more than one pass");
  if (assigned.size !== instanceCount)
    fail("renderPasses", "must assign every instance exactly once");
  return { deferredOpaque, alphaMaskForward };
}

function validatePack(
  pack: Pick<PackedSceneV2, "meshes" | "materials" | "instances" | "renderPasses" | "transport">,
): void {
  const { transport } = pack;
  const aligned: readonly [PackedSceneV2Buffer, number, string][] = [
    [transport.vertices, PACKED_SCENE_V2_VERTEX_STRIDE_BYTES, "vertices"],
    [transport.indices, Uint32Array.BYTES_PER_ELEMENT, "indices"],
    [transport.materials, PACKED_SCENE_V2_MATERIAL_STRIDE_BYTES, "materials"],
    [transport.instances, PACKED_SCENE_V2_INSTANCE_STRIDE_BYTES, "instances"],
    [transport.indirect, PACKED_SCENE_V2_INDEXED_INDIRECT_STRIDE_BYTES, "indirect"],
  ];
  aligned.forEach(([entry, stride, name]) => {
    if (entry.bytes % stride !== 0)
      fail(`transport.${name}.bytes`, `must be aligned to ${stride} bytes`);
  });
  const vertexCapacity = transport.vertices.bytes / PACKED_SCENE_V2_VERTEX_STRIDE_BYTES;
  const indexCapacity = transport.indices.bytes / Uint32Array.BYTES_PER_ELEMENT;
  if (pack.materials.length !== transport.materials.bytes / PACKED_SCENE_V2_MATERIAL_STRIDE_BYTES)
    fail("materials", "must exactly fill material buffer capacity");
  if (pack.instances.length !== transport.instances.bytes / PACKED_SCENE_V2_INSTANCE_STRIDE_BYTES)
    fail("instances", "must exactly fill instance buffer capacity");
  if (
    transport.indirect.bytes / PACKED_SCENE_V2_INDEXED_INDIRECT_STRIDE_BYTES !==
    pack.meshes.length * 3
  )
    fail("transport.indirect.bytes", "must contain exactly three commands per mesh");
  pack.meshes.forEach((mesh, meshIndex) => {
    const instanceIndices = pack.instances
      .map((instance, instanceIndex) => ({ instance, instanceIndex }))
      .filter(({ instance }) => instance.meshIndex === meshIndex)
      .map(({ instanceIndex }) => instanceIndex);
    if (instanceIndices.length === 0)
      fail(`meshes[${meshIndex}]`, "must be referenced by at least one instance");
    const instanceOffset = instanceIndices[0];
    if (instanceIndices.some((instanceIndex, offset) => instanceIndex !== instanceOffset + offset))
      fail(`meshes[${meshIndex}]`, "instances must occupy one contiguous mesh-local span");
    mesh.lods.forEach((lod, lodIndex) => {
      const path = `meshes[${meshIndex}].lods[${lodIndex}]`;
      if (
        lod.indirectByteOffset !==
        (meshIndex * 3 + lodIndex) * PACKED_SCENE_V2_INDEXED_INDIRECT_STRIDE_BYTES
      )
        fail(
          `${path}.indirectByteOffset`,
          "must identify the mesh/LOD command in deterministic order",
        );
      if (lod.instanceOffset !== instanceOffset)
        fail(
          `${path}.instanceOffset`,
          "must identify the mesh-local span in the global instance buffer",
        );
      if (
        (lod.state === "draw" && lod.instanceCount !== instanceIndices.length) ||
        (lod.state === "culled" && lod.instanceCount !== 0)
      )
        fail(
          `${path}.instanceCount`,
          "must cover the complete mesh span when drawn and zero it when culled",
        );
      if (lod.instanceOffset + lod.instanceCount > pack.instances.length)
        fail(`${path}.instanceOffset`, "instance span exceeds the instance buffer");
      if (lod.baseVertex + lod.vertexCount > vertexCapacity)
        fail(`${path}.baseVertex`, "exceeds vertex buffer");
      if (lod.firstIndex + lod.indexCount > indexCapacity)
        fail(`${path}.firstIndex`, "exceeds index buffer");
    });
  });
  const vertexRanges = pack.meshes
    .flatMap((mesh) =>
      mesh.lods
        .filter((lod) => lod.state === "draw")
        .map((lod) => ({
          start: lod.baseVertex,
          end: lod.baseVertex + lod.vertexCount,
        })),
    )
    .sort((left, right) => left.start - right.start);
  const indexRanges = pack.meshes
    .flatMap((mesh) =>
      mesh.lods
        .filter((lod) => lod.state === "draw")
        .map((lod) => ({
          start: lod.firstIndex,
          end: lod.firstIndex + lod.indexCount,
        })),
    )
    .sort((left, right) => left.start - right.start);
  const requireExactCoverage = (
    ranges: readonly { start: number; end: number }[],
    capacity: number,
    path: string,
  ) => {
    let cursor = 0;
    for (const range of ranges) {
      if (range.start !== cursor) fail(path, "LOD ranges must be contiguous and non-overlapping");
      cursor = range.end;
    }
    if (cursor !== capacity) fail(path, "LOD ranges must exactly cover the buffer");
  };
  requireExactCoverage(vertexRanges, vertexCapacity, "transport.vertices");
  requireExactCoverage(indexRanges, indexCapacity, "transport.indices");
  const alpha = new Set(pack.renderPasses.alphaMaskForward);
  const usedMaterials = new Set<number>();
  pack.instances.forEach((instance, index) => {
    const material = pack.materials[instance.materialIndex];
    usedMaterials.add(instance.materialIndex);
    if ((material.alphaMode === "MASK") !== alpha.has(index))
      fail(`instances[${index}]`, "material alpha mode must match its render pass");
    if (material.role === "fence" && !alpha.has(index))
      fail(`instances[${index}]`, "fence may only be rendered in alphaMaskForward");
  });
  if (usedMaterials.size !== pack.materials.length)
    fail("materials", "every material must be referenced by an instance");
}

/** Parse Pack v2 metadata only; the loader must separately verify each byte hash. */
export function parsePackedSceneV2(value: unknown): PackedSceneV2 {
  const source = object(value, "pack");
  if (text(source.format, "format") !== PACKED_SCENE_V2_FORMAT)
    fail("format", `must equal ${PACKED_SCENE_V2_FORMAT}`);
  if (integer(source.version, "version", 1) !== PACKED_SCENE_V2_VERSION)
    fail("version", `must equal ${PACKED_SCENE_V2_VERSION}`);
  if (text(source.coordinateSystem, "coordinateSystem") !== PACKED_SCENE_V2_COORDINATE_SYSTEM)
    fail("coordinateSystem", `must equal ${PACKED_SCENE_V2_COORDINATE_SYSTEM}`);
  if (source.placeholder !== false)
    fail("placeholder", "reviewed Pack v2 must not be a placeholder");
  if (text(source.indexFormat, "indexFormat") !== "uint32") fail("indexFormat", "must be uint32");
  exactLayout(
    source.vertexLayout,
    "vertexLayout",
    PACKED_SCENE_V2_VERTEX_STRIDE_BYTES,
    PACKED_SCENE_V2_VERTEX_LAYOUT,
  );
  exactLayout(
    source.materialLayout,
    "materialLayout",
    PACKED_SCENE_V2_MATERIAL_STRIDE_BYTES,
    PACKED_SCENE_V2_MATERIAL_LAYOUT,
  );
  exactLayout(
    source.instanceLayout,
    "instanceLayout",
    PACKED_SCENE_V2_INSTANCE_STRIDE_BYTES,
    PACKED_SCENE_V2_INSTANCE_LAYOUT,
  );
  exactLayout(
    source.indirectCommandLayout,
    "indirectCommandLayout",
    PACKED_SCENE_V2_INDEXED_INDIRECT_STRIDE_BYTES,
    PACKED_SCENE_V2_INDEXED_INDIRECT_LAYOUT,
  );
  const parsedTransport = parseTransport(source.transport);
  const parsedMeshes = parseMeshes(source.meshes);
  const parsedMaterials = parseMaterials(source.materials, parsedTransport.textures.length);
  const parsedInstances = parseInstances(
    source.instances,
    parsedMeshes.length,
    parsedMaterials.length,
  );
  const renderPasses = parsePasses(source.renderPasses, parsedInstances.length);
  if (parsedMeshes.length === 0 || parsedMaterials.length === 0 || parsedInstances.length === 0)
    fail("pack", "reviewed Pack v2 requires mesh, material, and instance payload");
  const pack: PackedSceneV2 = {
    format: PACKED_SCENE_V2_FORMAT,
    version: PACKED_SCENE_V2_VERSION,
    placeholder: false,
    coordinateSystem: PACKED_SCENE_V2_COORDINATE_SYSTEM,
    indexFormat: "uint32",
    meshes: parsedMeshes,
    materials: parsedMaterials,
    instances: parsedInstances,
    renderPasses,
    transport: parsedTransport,
  };
  validatePack(pack);
  return pack;
}
