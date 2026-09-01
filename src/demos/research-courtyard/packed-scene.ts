export const PACKED_SCENE_FORMAT = "graphics-portfolio-packed-scene";
export const PACKED_SCENE_VERSION = 1;
export const PACKED_SCENE_COORDINATE_SYSTEM = "right-handed-y-up-meters";
export const PACKED_SCENE_VERTEX_STRIDE_BYTES = 32;
export const PACKED_SCENE_INDIRECT_ALIGNMENT_BYTES = 32;

export type PackedSceneReadiness = "preview-placeholder" | "reviewed";
export type PackedSceneAlphaMode = "OPAQUE" | "MASK";

export interface PackedSceneVertexAttribute {
  semantic: "POSITION" | "NORMAL_OCT" | "TANGENT" | "TEXCOORD_0" | "PADDING";
  format: "float32x3" | "snorm16x2" | "snorm16x4" | "float16x2" | "uint32";
  offsetBytes: number;
}

export interface PackedSceneMesh {
  id: string;
  vertexCount: number;
  indexCount: number;
  baseVertex: number;
  indexOffset: number;
  bounds: { center: readonly [number, number, number]; radius: number };
  lod: { lod0Triangles: number; lod1Triangles: number; lod2Triangles: number };
}

export interface PackedSceneMaterial {
  id: string;
  alphaMode: PackedSceneAlphaMode;
  doubleSided: boolean;
}

export interface PackedSceneInstance {
  meshId: string;
  material: string;
  transform: readonly [
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
}

export interface PackedSceneBinaryBuffer {
  uri: string;
  byteLength: number;
}

export interface PackedSceneTextureSource {
  id: string;
  ktx2: string | null;
  webpFallback: string | null;
}

export interface PackedSceneTransport {
  vertices: PackedSceneBinaryBuffer | null;
  indices: PackedSceneBinaryBuffer | null;
  textures: PackedSceneTextureSource[];
}

export interface PackedScene {
  readiness: PackedSceneReadiness;
  generator: string;
  notice: string;
  coordinateSystem: typeof PACKED_SCENE_COORDINATE_SYSTEM;
  vertexLayout: {
    strideBytes: typeof PACKED_SCENE_VERTEX_STRIDE_BYTES;
    attributes: readonly PackedSceneVertexAttribute[];
  };
  indexFormat: "uint32";
  materials: readonly PackedSceneMaterial[];
  indirect: { alignmentBytes: typeof PACKED_SCENE_INDIRECT_ALIGNMENT_BYTES; firstInstance: 0 };
  meshes: readonly PackedSceneMesh[];
  instances: readonly PackedSceneInstance[];
  renderPasses: { deferredOpaque: readonly string[]; alphaMaskForward: readonly string[] };
  transport: PackedSceneTransport;
}

export interface TextureCapability {
  ktx2: boolean;
}

export type TextureSelection =
  { kind: "ktx2"; uri: string } | { kind: "webp"; uri: string } | { kind: "unavailable" };

export class PackedSceneValidationError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(path + ": " + message);
    this.name = "PackedSceneValidationError";
  }
}

const REQUIRED_VERTEX_ATTRIBUTES: readonly PackedSceneVertexAttribute[] = [
  { semantic: "POSITION", format: "float32x3", offsetBytes: 0 },
  { semantic: "NORMAL_OCT", format: "snorm16x2", offsetBytes: 12 },
  { semantic: "TANGENT", format: "snorm16x4", offsetBytes: 16 },
  { semantic: "TEXCOORD_0", format: "float16x2", offsetBytes: 24 },
  { semantic: "PADDING", format: "uint32", offsetBytes: 28 },
];

function fail(path: string, message: string): never {
  throw new PackedSceneValidationError(path, message);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "must be an object");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) fail(path, "must be a non-empty string");
  return value;
}

function integer(value: unknown, path: string, minimum = 0): number {
  if (typeof value !== "number" || Number.isInteger(value) === false || value < minimum) {
    fail(path, "must be an integer >= " + minimum);
  }
  return value;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || Number.isFinite(value) === false) fail(path, "must be finite");
  return value;
}

function list(value: unknown, path: string): unknown[] {
  if (Array.isArray(value) === false) fail(path, "must be an array");
  return value;
}

function tuple3(value: unknown, path: string): [number, number, number] {
  const values = list(value, path);
  if (values.length !== 3) fail(path, "must have exactly three values");
  return [
    finite(values[0], path + "[0]"),
    finite(values[1], path + "[1]"),
    finite(values[2], path + "[2]"),
  ];
}

function transform3x4(value: unknown, path: string): PackedSceneInstance["transform"] {
  const values = list(value, path);
  if (values.length !== 12) fail(path, "must be a 3x4 transform");
  return values.map((entry, index) =>
    finite(entry, path + "[" + index + "]"),
  ) as unknown as PackedSceneInstance["transform"];
}

function parseVertexLayout(value: unknown): PackedScene["vertexLayout"] {
  const layout = record(value, "vertexLayout");
  if (
    integer(layout.strideBytes, "vertexLayout.strideBytes") !== PACKED_SCENE_VERTEX_STRIDE_BYTES
  ) {
    fail("vertexLayout.strideBytes", "must equal " + PACKED_SCENE_VERTEX_STRIDE_BYTES);
  }
  const attributes = list(layout.attributes, "vertexLayout.attributes").map((entry, index) => {
    const attribute = record(entry, "vertexLayout.attributes[" + index + "]");
    return {
      semantic: text(
        attribute.semantic,
        "vertexLayout.attributes[" + index + "].semantic",
      ) as PackedSceneVertexAttribute["semantic"],
      format: text(
        attribute.format,
        "vertexLayout.attributes[" + index + "].format",
      ) as PackedSceneVertexAttribute["format"],
      offsetBytes: integer(
        attribute.offsetBytes,
        "vertexLayout.attributes[" + index + "].offsetBytes",
      ),
    };
  });
  if (attributes.length !== REQUIRED_VERTEX_ATTRIBUTES.length) {
    fail("vertexLayout.attributes", "must match the fixed 32-byte layout");
  }
  REQUIRED_VERTEX_ATTRIBUTES.forEach((expected, index) => {
    const actual = attributes[index];
    if (
      actual.semantic !== expected.semantic ||
      actual.format !== expected.format ||
      actual.offsetBytes !== expected.offsetBytes
    ) {
      fail("vertexLayout.attributes[" + index + "]", "does not match the fixed 32-byte layout");
    }
  });
  return { strideBytes: PACKED_SCENE_VERTEX_STRIDE_BYTES, attributes };
}

function parseMaterialLayout(value: unknown): void {
  const layout = record(value, "materialLayout");
  const factors = list(layout.factors, "materialLayout.factors");
  const expected = ["baseColor", "metallic", "roughness"];
  if (
    factors.length !== expected.length ||
    factors.some((factor, index) => factor !== expected[index])
  ) {
    fail("materialLayout.factors", "must be baseColor, metallic, roughness");
  }
  if (text(layout.textureIndex, "materialLayout.textureIndex") !== "uint32") {
    fail("materialLayout.textureIndex", "must be uint32");
  }
  const modes = list(layout.alphaModes, "materialLayout.alphaModes");
  if (modes.length !== 2 || modes[0] !== "OPAQUE" || modes[1] !== "MASK") {
    fail("materialLayout.alphaModes", "must contain OPAQUE then MASK");
  }
  if (text(layout.doubleSided, "materialLayout.doubleSided") !== "bool") {
    fail("materialLayout.doubleSided", "must be bool");
  }
}

function parseTransport(value: unknown): PackedSceneTransport {
  if (value === undefined) return { vertices: null, indices: null, textures: [] };
  const source = record(value, "transport");
  return {
    vertices: parseBuffer(source.vertices, "transport.vertices"),
    indices: parseBuffer(source.indices, "transport.indices"),
    textures: list(source.textures ?? [], "transport.textures").map((entry, index) => {
      const texture = record(entry, "transport.textures[" + index + "]");
      const ktx2 =
        texture.ktx2 === null || texture.ktx2 === undefined
          ? null
          : text(texture.ktx2, "transport.textures[" + index + "].ktx2");
      const webpFallback =
        texture.webpFallback === null || texture.webpFallback === undefined
          ? null
          : text(texture.webpFallback, "transport.textures[" + index + "].webpFallback");
      if (ktx2 === null && webpFallback === null)
        fail("transport.textures[" + index + "]", "needs ktx2 or webpFallback");
      return { id: text(texture.id, "transport.textures[" + index + "].id"), ktx2, webpFallback };
    }),
  };
}

function parseBuffer(value: unknown, path: string): PackedSceneBinaryBuffer | null {
  if (value === undefined || value === null) return null;
  const buffer = record(value, path);
  return {
    uri: text(buffer.uri, path + ".uri"),
    byteLength: integer(buffer.byteLength, path + ".byteLength", 1),
  };
}

function parseMeshes(value: unknown): PackedSceneMesh[] {
  const ids = new Set<string>();
  return list(value, "meshes").map((entry, index) => {
    const path = "meshes[" + index + "]";
    const mesh = record(entry, path);
    const id = text(mesh.id, path + ".id");
    if (ids.has(id)) fail(path + ".id", "must be unique");
    ids.add(id);
    const vertexCount = integer(mesh.vertexCount, path + ".vertexCount", 1);
    const indexCount = integer(mesh.indexCount, path + ".indexCount", 3);
    if (indexCount % 3 !== 0) fail(path + ".indexCount", "must be triangle-aligned");
    const baseVertex = integer(mesh.baseVertex, path + ".baseVertex");
    const indexOffset = integer(mesh.indexOffset, path + ".indexOffset");
    const bounds = record(mesh.bounds, path + ".bounds");
    const radius = finite(bounds.radius, path + ".bounds.radius");
    if (radius <= 0) fail(path + ".bounds.radius", "must be > 0");
    const lod = record(mesh.lod, path + ".lod");
    const lod0Triangles = integer(lod.lod0Triangles, path + ".lod.lod0Triangles");
    const lod1Triangles = integer(lod.lod1Triangles, path + ".lod.lod1Triangles");
    const lod2Triangles = integer(lod.lod2Triangles, path + ".lod.lod2Triangles");
    if (lod0Triangles < lod1Triangles || lod1Triangles < lod2Triangles) {
      fail(path + ".lod", "must be monotonic lod0 >= lod1 >= lod2");
    }
    if (lod0Triangles * 3 > indexCount) fail(path + ".lod.lod0Triangles", "exceeds indexCount");
    return {
      id,
      vertexCount,
      indexCount,
      baseVertex,
      indexOffset,
      bounds: { center: tuple3(bounds.center, path + ".bounds.center"), radius },
      lod: { lod0Triangles, lod1Triangles, lod2Triangles },
    };
  });
}

function parseMaterials(value: unknown): PackedSceneMaterial[] {
  if (value === undefined) return [];
  const ids = new Set<string>();
  return list(value, "materials").map((entry, index) => {
    const path = "materials[" + index + "]";
    const material = record(entry, path);
    const id = text(material.id, path + ".id");
    if (ids.has(id)) fail(path + ".id", "must be unique");
    ids.add(id);
    const alphaMode = text(material.alphaMode, path + ".alphaMode");
    if (alphaMode !== "OPAQUE" && alphaMode !== "MASK")
      fail(path + ".alphaMode", "must be OPAQUE or MASK");
    if (typeof material.doubleSided !== "boolean") fail(path + ".doubleSided", "must be boolean");
    return { id, alphaMode, doubleSided: material.doubleSided };
  });
}

function parseInstances(value: unknown, meshes: readonly PackedSceneMesh[]): PackedSceneInstance[] {
  const knownMeshes = new Set(meshes.map((mesh) => mesh.id));
  return list(value, "instances").map((entry, index) => {
    const path = "instances[" + index + "]";
    const instance = record(entry, path);
    const meshId = text(instance.meshId, path + ".meshId");
    if (knownMeshes.has(meshId) === false) fail(path + ".meshId", "does not reference a mesh");
    return {
      meshId,
      material: text(instance.material, path + ".material"),
      transform: transform3x4(instance.transform, path + ".transform"),
    };
  });
}

function parsePasses(
  value: unknown,
  meshes: readonly PackedSceneMesh[],
): PackedScene["renderPasses"] {
  const passes = record(value, "renderPasses");
  const knownMeshes = new Set(meshes.map((mesh) => mesh.id));
  const parseNames = (entry: unknown, path: string) => {
    const names = list(entry, path).map((name, index) => text(name, path + "[" + index + "]"));
    if (new Set(names).size !== names.length) fail(path, "must not repeat mesh ids");
    names.forEach((name) => {
      if (knownMeshes.has(name) === false) fail(path, "references an unknown mesh");
    });
    return names;
  };
  const deferredOpaque = parseNames(passes.deferredOpaque, "renderPasses.deferredOpaque");
  const alphaMaskForward = parseNames(passes.alphaMaskForward, "renderPasses.alphaMaskForward");
  const assigned = new Set([...deferredOpaque, ...alphaMaskForward]);
  if (assigned.size !== deferredOpaque.length + alphaMaskForward.length) {
    fail("renderPasses", "must not assign a mesh to both opaque and alpha-mask passes");
  }
  if (assigned.size !== meshes.length) fail("renderPasses", "must assign every mesh exactly once");
  return { deferredOpaque, alphaMaskForward };
}

function validateBinaryBounds(
  meshes: readonly PackedSceneMesh[],
  transport: PackedSceneTransport,
): void {
  if (transport.vertices) {
    const vertexCapacity = transport.vertices.byteLength / PACKED_SCENE_VERTEX_STRIDE_BYTES;
    if (Number.isInteger(vertexCapacity) === false) {
      fail("transport.vertices.byteLength", "must be aligned to the 32-byte vertex stride");
    }
    meshes.forEach((mesh, index) => {
      if (mesh.baseVertex + mesh.vertexCount > vertexCapacity) {
        fail("meshes[" + index + "].baseVertex", "exceeds vertex buffer bounds");
      }
    });
  }
  if (transport.indices) {
    const indexCapacity = transport.indices.byteLength / Uint32Array.BYTES_PER_ELEMENT;
    if (Number.isInteger(indexCapacity) === false) {
      fail("transport.indices.byteLength", "must be aligned to uint32 indices");
    }
    meshes.forEach((mesh, index) => {
      if (mesh.indexOffset + mesh.indexCount > indexCapacity) {
        fail("meshes[" + index + "].indexOffset", "exceeds index buffer bounds");
      }
    });
  }
}

function validateMaterialPasses(
  materials: readonly PackedSceneMaterial[],
  instances: readonly PackedSceneInstance[],
  passes: PackedScene["renderPasses"],
): void {
  if (materials.length === 0) return;
  const materialById = new Map(materials.map((material) => [material.id, material]));
  const alphaMeshes = new Set(passes.alphaMaskForward);
  const opaqueMeshes = new Set(passes.deferredOpaque);
  instances.forEach((instance, index) => {
    const material = materialById.get(instance.material);
    if (!material) fail("instances[" + index + "].material", "does not reference a material");
    if (material.alphaMode === "MASK" && alphaMeshes.has(instance.meshId) === false) {
      fail("instances[" + index + "]", "MASK material must be in alphaMaskForward");
    }
    if (material.alphaMode === "OPAQUE" && opaqueMeshes.has(instance.meshId) === false) {
      fail("instances[" + index + "]", "OPAQUE material must be in deferredOpaque");
    }
  });
}

export function parsePackedScene(value: unknown): PackedScene {
  const source = record(value, "pack");
  if (text(source.format, "format") !== PACKED_SCENE_FORMAT) {
    fail("format", "must equal " + PACKED_SCENE_FORMAT);
  }
  if (integer(source.version, "version", 1) !== PACKED_SCENE_VERSION) {
    fail("version", "must equal " + PACKED_SCENE_VERSION);
  }
  if (text(source.coordinateSystem, "coordinateSystem") !== PACKED_SCENE_COORDINATE_SYSTEM) {
    fail("coordinateSystem", "must equal " + PACKED_SCENE_COORDINATE_SYSTEM);
  }
  if (text(source.indexFormat, "indexFormat") !== "uint32") fail("indexFormat", "must be uint32");
  const placeholder = source.placeholder === true;
  if (typeof source.placeholder !== "boolean") fail("placeholder", "must be boolean");
  const generator = text(source.generator, "generator");
  const notice = text(source.notice, "notice");
  const vertexLayout = parseVertexLayout(source.vertexLayout);
  parseMaterialLayout(source.materialLayout);
  const indirect = record(source.indirectCommand, "indirectCommand");
  if (
    integer(indirect.alignmentBytes, "indirectCommand.alignmentBytes") !==
    PACKED_SCENE_INDIRECT_ALIGNMENT_BYTES
  ) {
    fail("indirectCommand.alignmentBytes", "must equal " + PACKED_SCENE_INDIRECT_ALIGNMENT_BYTES);
  }
  if (integer(indirect.firstInstance, "indirectCommand.firstInstance") !== 0) {
    fail("indirectCommand.firstInstance", "must be zero");
  }
  const meshes = parseMeshes(source.meshes);
  if (meshes.length === 0) fail("meshes", "must not be empty");
  const instances = parseInstances(source.instances, meshes);
  const materials = parseMaterials(source.materials);
  const renderPasses = parsePasses(source.renderPasses, meshes);
  const transport = parseTransport(source.transport);
  if (placeholder === false && (!transport.vertices || !transport.indices)) {
    fail("transport", "reviewed packs require vertex and index binary buffers");
  }
  validateBinaryBounds(meshes, transport);
  validateMaterialPasses(materials, instances, renderPasses);
  return {
    readiness: placeholder ? "preview-placeholder" : "reviewed",
    generator,
    notice,
    coordinateSystem: PACKED_SCENE_COORDINATE_SYSTEM,
    vertexLayout,
    indexFormat: "uint32",
    materials,
    indirect: { alignmentBytes: PACKED_SCENE_INDIRECT_ALIGNMENT_BYTES, firstInstance: 0 },
    meshes,
    instances,
    renderPasses,
    transport,
  };
}

export function selectPackedSceneTexture(
  source: PackedSceneTextureSource,
  capability: TextureCapability,
): TextureSelection {
  if (capability.ktx2 && source.ktx2) return { kind: "ktx2", uri: source.ktx2 };
  if (source.webpFallback) return { kind: "webp", uri: source.webpFallback };
  return { kind: "unavailable" };
}
