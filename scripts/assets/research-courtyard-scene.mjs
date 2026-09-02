import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import {
  encodeResearchCourtyardBinary,
  INDEXED_INDIRECT_STRIDE,
  INSTANCE_STRIDE,
  MATERIAL_STRIDE,
  NO_TEXTURE,
  VERTEX_STRIDE,
} from "./research-courtyard-binary.mjs";
import { compressResearchCourtyardBuffers } from "./research-courtyard-meshopt.mjs";

export const researchCourtyardSceneFormat = "graphics-portfolio-research-courtyard-scene";
export const researchCourtyardSceneVersion = 1;
export const animatedInstanceFlag = 1;

export class ResearchCourtyardSceneError extends Error {
  constructor(pathname, message) {
    super(`${pathname}: ${message}`);
    this.name = "ResearchCourtyardSceneError";
    this.path = pathname;
  }
}

function fail(pathname, message) {
  throw new ResearchCourtyardSceneError(pathname, message);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonical(child)]),
  );
}

function sha256Json(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

function canonicalJson(value) {
  return `${JSON.stringify(canonical(value), null, 2)}\n`;
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeCandidatePath(candidateRoot, relative) {
  if (
    typeof relative !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(relative) ||
    relative.includes("\\") ||
    relative.split("/").some((part) => !part || part === "." || part === "..")
  )
    fail("lodCandidate.files", "contains an unsafe path");
  const file = path.resolve(candidateRoot, relative);
  const relation = path.relative(candidateRoot, file);
  if (relation.startsWith("..") || path.isAbsolute(relation))
    fail("lodCandidate.files", "escaped the candidate root");
  return file;
}

export function loadResearchCourtyardLodCandidate(
  candidateRoot,
  { sourceSetSha256, recipeSha256 },
) {
  candidateRoot = path.resolve(candidateRoot);
  if (
    !existsSync(candidateRoot) ||
    !lstatSync(candidateRoot).isDirectory() ||
    lstatSync(candidateRoot).isSymbolicLink()
  )
    fail("lodCandidate", "directory is missing or unsafe");
  const manifestPath = path.join(candidateRoot, "lod-candidate.manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    fail("lodCandidate.manifest", error instanceof Error ? error.message : "invalid JSON");
  }
  if (
    manifest.format !== "graphics-portfolio-research-courtyard-lods" ||
    manifest.version !== 1 ||
    manifest.status !== "candidate" ||
    manifest.publishable !== false ||
    manifest.sourceSetSha256 !== sourceSetSha256 ||
    manifest.recipeSha256 !== recipeSha256 ||
    !Array.isArray(manifest.files) ||
    !Array.isArray(manifest.sources)
  )
    fail("lodCandidate.manifest", "identity or candidate status mismatch");
  const receipts = [...manifest.files]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((receipt) => ({
      path: receipt.path,
      bytes: receipt.bytes,
      sha256: receipt.sha256,
    }));
  if (sha256Bytes(canonicalJson(receipts)) !== manifest.candidateArtifactsSha256)
    fail("lodCandidate.manifest", "artifact digest mismatch");
  for (const receipt of receipts) {
    const file = safeCandidatePath(candidateRoot, receipt.path);
    if (
      !existsSync(file) ||
      !lstatSync(file).isFile() ||
      lstatSync(file).isSymbolicLink() ||
      statSync(file).size !== receipt.bytes ||
      sha256Bytes(readFileSync(file)) !== receipt.sha256
    )
      fail(receipt.path, "candidate bytes do not match their receipt");
  }
  const geometriesBySource = {};
  for (const source of manifest.sources) {
    const geometries = [];
    for (let level = 0; level < 3; level += 1) {
      const relative = `geometry/${source.sourceId}/lod${level}.json.gz`;
      const receipt = receipts.find((entry) => entry.path === relative);
      if (!receipt) fail(relative, "is missing from the candidate receipt");
      try {
        const decoded = gunzipSync(readFileSync(safeCandidatePath(candidateRoot, relative)), {
          maxOutputLength: 256 * 1024 * 1024,
        });
        const geometry = JSON.parse(decoded.toString("utf8"));
        if (geometry.sourceId !== source.sourceId)
          fail(relative, "geometry source identity mismatch");
        geometries.push(geometry);
      } catch (error) {
        if (error instanceof ResearchCourtyardSceneError) throw error;
        fail(relative, error instanceof Error ? error.message : "cannot decode geometry");
      }
    }
    geometriesBySource[source.sourceId] = geometries;
  }
  return {
    directory: candidateRoot,
    manifestPath,
    manifestSha256: sha256Bytes(readFileSync(manifestPath)),
    manifest,
    geometriesBySource,
  };
}

function finiteArray(value, length, pathname) {
  if (
    !Array.isArray(value) ||
    value.length !== length ||
    value.some((entry) => !Number.isFinite(entry))
  )
    fail(pathname, `must contain ${length} finite values`);
  return value;
}

function primitiveIdentity(primitive) {
  return [
    primitive.sourceId,
    primitive.partId,
    primitive.nodeName,
    primitive.primitiveIndex,
    primitive.material.name ?? "<default>",
  ].join("\u0000");
}

function primitiveMap(geometry, pathname) {
  const output = new Map();
  for (const part of geometry.parts ?? [])
    for (const primitive of part.primitives ?? []) {
      const id = primitiveIdentity(primitive);
      if (output.has(id)) fail(pathname, `duplicate primitive identity ${id}`);
      output.set(id, primitive);
    }
  return output;
}

function vertexObjects(primitive) {
  const count = primitive.positions.length / 3;
  if (
    !Number.isSafeInteger(count) ||
    count < 3 ||
    primitive.normals.length !== count * 3 ||
    primitive.tangents.length !== count * 4 ||
    primitive.uvs.length !== count * 2
  )
    fail(primitiveIdentity(primitive), "has incompatible normalized vertex arrays");
  return Array.from({ length: count }, (_, index) => ({
    position: primitive.positions.slice(index * 3, index * 3 + 3),
    normal: primitive.normals.slice(index * 3, index * 3 + 3),
    tangent: primitive.tangents.slice(index * 4, index * 4 + 4),
    uv: primitive.uvs.slice(index * 2, index * 2 + 2),
  }));
}

function primitiveBounds(primitive) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < primitive.positions.length; index += 3)
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], primitive.positions[index + axis]);
      max[axis] = Math.max(max[axis], primitive.positions[index + axis]);
    }
  if (!min.every(Number.isFinite) || !max.every(Number.isFinite))
    fail(primitiveIdentity(primitive), "has no finite bounds");
  const center = min.map((value, axis) => (value + max[axis]) / 2);
  let radius = 0;
  for (let index = 0; index < primitive.positions.length; index += 3)
    radius = Math.max(
      radius,
      Math.hypot(
        primitive.positions[index] - center[0],
        primitive.positions[index + 1] - center[1],
        primitive.positions[index + 2] - center[2],
      ),
    );
  if (!(radius > 0)) fail(primitiveIdentity(primitive), "has a degenerate sphere");
  return { min, max, center, radius };
}

function addFace(output, center, tangent, bitangent, normal, halfWidth, halfHeight, uvScale) {
  const base = output.positions.length / 3;
  const signs = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  for (const [u, v] of signs) {
    output.positions.push(
      center[0] + tangent[0] * halfWidth * u + bitangent[0] * halfHeight * v,
      center[1] + tangent[1] * halfWidth * u + bitangent[1] * halfHeight * v,
      center[2] + tangent[2] * halfWidth * u + bitangent[2] * halfHeight * v,
    );
    output.normals.push(...normal);
    output.tangents.push(...tangent, 1);
    output.uvs.push((u + 1) * halfWidth * uvScale, (v + 1) * halfHeight * uvScale);
  }
  output.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

export function createArchitectureBox(entry) {
  if (entry?.primitive !== "box")
    fail(entry?.id ?? "architecture", "only box primitives are supported");
  const center = finiteArray(entry.center, 3, `${entry.id}.center`);
  const size = finiteArray(entry.size, 3, `${entry.id}.size`);
  if (size.some((value) => value <= 0)) fail(`${entry.id}.size`, "must remain positive");
  if (!(entry.uvMetersPerRepeat > 0)) fail(`${entry.id}.uvMetersPerRepeat`, "must be positive");
  const [hx, hy, hz] = size.map((value) => value / 2);
  const output = {
    sourceId: "architecture",
    partId: entry.id,
    nodeName: entry.id,
    primitiveIndex: 0,
    positions: [],
    normals: [],
    tangents: [],
    uvs: [],
    indices: [],
    material: {
      name: entry.materialId,
      alphaMode: "OPAQUE",
      alphaCutoff: 0.5,
      doubleSided: false,
      baseColorFactor: [1, 1, 1, 1],
      emissiveFactor: [0, 0, 0],
      metallicFactor: 0,
      roughnessFactor: 1,
      normalScale: 1,
      textureTransform: null,
    },
  };
  const repeat = 1 / entry.uvMetersPerRepeat;
  addFace(
    output,
    [center[0] + hx, center[1], center[2]],
    [0, 0, -1],
    [0, 1, 0],
    [1, 0, 0],
    hz,
    hy,
    repeat,
  );
  addFace(
    output,
    [center[0] - hx, center[1], center[2]],
    [0, 0, 1],
    [0, 1, 0],
    [-1, 0, 0],
    hz,
    hy,
    repeat,
  );
  addFace(
    output,
    [center[0], center[1] + hy, center[2]],
    [1, 0, 0],
    [0, 0, -1],
    [0, 1, 0],
    hx,
    hz,
    repeat,
  );
  addFace(
    output,
    [center[0], center[1] - hy, center[2]],
    [1, 0, 0],
    [0, 0, 1],
    [0, -1, 0],
    hx,
    hz,
    repeat,
  );
  addFace(
    output,
    [center[0], center[1], center[2] + hz],
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    hx,
    hy,
    repeat,
  );
  addFace(
    output,
    [center[0], center[1], center[2] - hz],
    [-1, 0, 0],
    [0, 1, 0],
    [0, 0, -1],
    hx,
    hy,
    repeat,
  );
  return output;
}

function textureCatalog(value) {
  if (!value || !Array.isArray(value.textures) || !value.materials)
    fail("textureCatalog", "requires textures and material bindings");
  const ids = new Set();
  const textures = value.textures.map((texture, index) => {
    if (
      typeof texture?.id !== "string" ||
      !/^[a-z0-9][a-z0-9-]*$/.test(texture.id) ||
      ids.has(texture.id) ||
      !["srgb", "linear"].includes(texture.colorSpace) ||
      typeof texture.ktx2 !== "string" ||
      typeof texture.webp !== "string"
    )
      fail(`textureCatalog.textures[${index}]`, "has an invalid or duplicate record");
    ids.add(texture.id);
    return clone(texture);
  });
  return {
    textures,
    indices: new Map(textures.map((texture, index) => [texture.id, index])),
    materials: value.materials,
  };
}

function textureIndex(catalog, id, expectedColorSpace, pathname) {
  if (id === null) return NO_TEXTURE;
  if (typeof id !== "string" || !catalog.indices.has(id))
    fail(pathname, "references an unknown texture");
  const index = catalog.indices.get(id);
  if (catalog.textures[index].colorSpace !== expectedColorSpace)
    fail(pathname, `must reference a ${expectedColorSpace} texture`);
  return index;
}

function binding(catalog, key) {
  const value = catalog.materials[key];
  if (!value || typeof value !== "object") fail(`textureCatalog.materials.${key}`, "is required");
  return {
    baseColor: textureIndex(catalog, value.baseColor, "srgb", `${key}.baseColor`),
    normal: textureIndex(catalog, value.normal, "linear", `${key}.normal`),
    orm: textureIndex(catalog, value.orm, "linear", `${key}.orm`),
  };
}

function materialFromPrimitive(recipe, catalog, meshSource, primitive) {
  const sourceId = meshSource.sourceId;
  const name = primitive.material.name;
  if (typeof name !== "string" || !name)
    fail(primitiveIdentity(primitive), "requires a named material");
  const override = meshSource.materialOverrides.find((entry) => entry.materialName === name);
  const alphaMode = override?.alphaMode ?? primitive.material.alphaMode;
  const doubleSided = override?.doubleSided ?? primitive.material.doubleSided;
  if (alphaMode !== "OPAQUE" && alphaMode !== "MASK")
    fail(`${sourceId}:${name}`, "must normalize BLEND before Pack v2");
  const renderPass =
    override?.renderPass === "alpha-mask-forward" || alphaMode === "MASK"
      ? "alphaMaskForward"
      : "deferredOpaque";
  const role = sourceId === "modular-chainlink-fence" ? "fence" : "default";
  if (
    role === "fence" &&
    (alphaMode !== "MASK" || doubleSided !== true || renderPass !== "alphaMaskForward")
  )
    fail(`${sourceId}:${name}`, "fence materials must route to alpha-mask forward");
  const textureIndices = binding(catalog, `${sourceId}:${name}`);
  return {
    key: `${sourceId}:${name}`,
    descriptor: {
      id: `${sourceId}:${name}`,
      role,
      alphaMode,
      doubleSided,
      baseColor: finiteArray(
        primitive.material.baseColorFactor,
        4,
        `${sourceId}:${name}.baseColorFactor`,
      ),
      emissive: finiteArray(
        primitive.material.emissiveFactor,
        3,
        `${sourceId}:${name}.emissiveFactor`,
      ),
      metallic: primitive.material.metallicFactor,
      roughness: primitive.material.roughnessFactor,
      alphaCutoff: override?.alphaCutoff ?? primitive.material.alphaCutoff,
      normalScale: primitive.material.normalScale,
      textureIndices,
      flags: (alphaMode === "MASK" ? 1 : 0) | (doubleSided ? 2 : 0),
    },
    renderPass,
  };
}

function materialFromArchitecture(recipe, catalog, primitive) {
  const material = recipe.materialSources.find(
    (entry) => entry.materialId === primitive.material.name,
  );
  if (!material) fail(primitive.material.name, "architecture material is absent from the recipe");
  const textureIndices = binding(catalog, `architecture:${material.materialId}`);
  return {
    key: `architecture:${material.materialId}`,
    descriptor: {
      id: `architecture:${material.materialId}`,
      role: "default",
      alphaMode: "OPAQUE",
      doubleSided: false,
      baseColor: [1, 1, 1, 1],
      emissive: [0, 0, 0],
      metallic: material.metallicFactor,
      roughness: 1,
      alphaCutoff: 0.5,
      normalScale: 1,
      textureIndices,
      flags: 0,
    },
    renderPass: "deferredOpaque",
  };
}

function registerMaterial(materials, material) {
  const existing = materials.get(material.key);
  if (existing && sha256Json(existing) !== sha256Json(material.descriptor))
    fail(material.key, "resolved to conflicting material descriptors");
  materials.set(material.key, material.descriptor);
}

function transformFor(entry) {
  const translation = finiteArray(entry.translation, 3, `${entry.instanceId}.translation`);
  const scale = finiteArray(entry.scale, 3, `${entry.instanceId}.scale`);
  const radians = (entry.rotationYDegrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [
    cosine * scale[0],
    0,
    sine * scale[2],
    translation[0],
    0,
    scale[1],
    0,
    translation[1],
    -sine * scale[0],
    0,
    cosine * scale[2],
    translation[2],
  ];
}

function transformPoint(matrix, point) {
  return [
    matrix[0] * point[0] + matrix[1] * point[1] + matrix[2] * point[2] + matrix[3],
    matrix[4] * point[0] + matrix[5] * point[1] + matrix[6] * point[2] + matrix[7],
    matrix[8] * point[0] + matrix[9] * point[1] + matrix[10] * point[2] + matrix[11],
  ];
}

function worldSphere(local, matrix, scale) {
  const center = transformPoint(matrix, local.center);
  return [...center, local.radius * Math.max(...scale.map(Math.abs))];
}

function geometryHash(primitive) {
  return sha256Json({
    positions: primitive.positions,
    normals: primitive.normals,
    tangents: primitive.tangents,
    uvs: primitive.uvs,
    indices: primitive.indices,
  });
}

function lodPolicy(levels, pathname) {
  if (levels[2].state === "culled") return "culled-at-lod2";
  const counts = levels.map((level) => level.primitive.indices.length);
  const vertices = levels.map((level) => level.primitive.positions.length);
  const hashes = levels.map((level) => geometryHash(level.primitive));
  if (hashes[0] === hashes[1] && hashes[1] === hashes[2]) return "preserved";
  for (let level = 1; level < 3; level += 1)
    if (
      counts[level] > counts[level - 1] ||
      vertices[level] > vertices[level - 1] ||
      (counts[level] === counts[level - 1] && hashes[level] !== hashes[level - 1])
    )
      fail(pathname, "contains an increasing or unverifiable LOD");
  if (counts[0] > counts[1] && counts[1] > counts[2]) return "simplified";
  if (counts.some((count, index) => index > 0 && count < counts[index - 1])) return "mixed";
  fail(pathname, "changed geometry without a verified reduction");
}

function modelDrawables(recipe, geometriesBySource, catalog, materials) {
  const drawables = [];
  for (const meshSource of recipe.meshSources) {
    const geometries = geometriesBySource[meshSource.sourceId];
    if (!Array.isArray(geometries) || geometries.length !== 3)
      fail(meshSource.sourceId, "requires normalized LOD0/1/2 geometry");
    const maps = geometries.map((geometry, level) =>
      primitiveMap(geometry, `${meshSource.sourceId}.lod${level}`),
    );
    const base = [...maps[0].entries()].sort(([left], [right]) => left.localeCompare(right));
    for (const [identity, primitive] of base) {
      const lod1 = maps[1].get(identity);
      const lod2 = maps[2].get(identity);
      if (!lod1) fail(identity, "is missing from LOD1");
      const material = materialFromPrimitive(recipe, catalog, meshSource, primitive);
      registerMaterial(materials, material);
      const relativeErrors = meshSource.lod.maxErrors;
      const levels = [
        { state: "draw", primitive, relativeError: 0 },
        { state: "draw", primitive: lod1, relativeError: relativeErrors[1] },
        lod2
          ? { state: "draw", primitive: lod2, relativeError: relativeErrors[2] }
          : { state: "culled", primitive: null, relativeError: relativeErrors[2] },
      ];
      const instances = recipe.instances
        .filter(
          (instance) =>
            instance.sourceId === meshSource.sourceId && instance.partId === primitive.partId,
        )
        .sort((left, right) => left.instanceId.localeCompare(right.instanceId));
      if (instances.length === 0) fail(identity, "has no recipe instance for its selected part");
      drawables.push({
        id: identity.replaceAll("\u0000", "/"),
        materialKey: material.key,
        renderPass: material.renderPass,
        levels,
        lodPolicy: lodPolicy(levels, identity),
        localBounds: primitiveBounds(primitive),
        instances,
      });
    }
    const baseIdentities = new Set(maps[0].keys());
    for (const [level, map] of maps.entries())
      for (const identity of map.keys())
        if (!baseIdentities.has(identity))
          fail(`${meshSource.sourceId}.lod${level}`, `introduced ${identity}`);
  }
  return drawables;
}

function architectureDrawables(recipe, catalog, materials) {
  return recipe.architecture.map((entry) => {
    const primitive = createArchitectureBox(entry);
    const material = materialFromArchitecture(recipe, catalog, primitive);
    registerMaterial(materials, material);
    const levels = [0, 1, 2].map(() => ({
      state: "draw",
      primitive: clone(primitive),
      relativeError: 0,
    }));
    return {
      id: `architecture/${entry.id}`,
      materialKey: material.key,
      renderPass: material.renderPass,
      levels,
      lodPolicy: "preserved",
      localBounds: primitiveBounds(primitive),
      instances: [
        {
          instanceId: `architecture-${entry.id}`,
          translation: [0, 0, 0],
          rotationYDegrees: 0,
          scale: [1, 1, 1],
        },
      ],
    };
  });
}

function binaryMaterial(material) {
  return {
    baseColor: material.baseColor,
    emissive: material.emissive,
    metallic: material.metallic,
    roughness: material.roughness,
    alphaCutoff: material.alphaCutoff,
    normalScale: material.normalScale,
    baseColorTexture: material.textureIndices.baseColor,
    normalTexture: material.textureIndices.normal,
    ormTexture: material.textureIndices.orm,
    alphaMode: material.alphaMode,
    doubleSided: material.doubleSided,
  };
}

const vertexLayout = [
  { semantic: "POSITION", format: "float32x3", offsetBytes: 0 },
  { semantic: "NORMAL_OCT", format: "snorm16x2", offsetBytes: 12 },
  { semantic: "TANGENT", format: "snorm16x4", offsetBytes: 16 },
  { semantic: "TEXCOORD_0", format: "float16x2", offsetBytes: 24 },
  { semantic: "PADDING", format: "uint32", offsetBytes: 28 },
];
const materialLayout = [
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
const instanceLayout = [
  { semantic: "CURRENT_TRANSFORM", format: "float32x12", offsetBytes: 0 },
  { semantic: "PREVIOUS_TRANSFORM", format: "float32x12", offsetBytes: 48 },
  { semantic: "MATERIAL_INDEX", format: "uint32", offsetBytes: 96 },
  { semantic: "MESH_INDEX", format: "uint32", offsetBytes: 100 },
  { semantic: "FLAGS", format: "uint32", offsetBytes: 104 },
  { semantic: "WORLD_SPHERE", format: "float32x4", offsetBytes: 108 },
  { semantic: "PADDING", format: "uint32", offsetBytes: 124 },
];
const indirectLayout = [
  { semantic: "INDEX_COUNT", format: "uint32", offsetBytes: 0 },
  { semantic: "INSTANCE_COUNT", format: "uint32", offsetBytes: 4 },
  { semantic: "FIRST_INDEX", format: "uint32", offsetBytes: 8 },
  { semantic: "BASE_VERTEX", format: "sint32", offsetBytes: 12 },
  { semantic: "FIRST_INSTANCE", format: "uint32", offsetBytes: 16 },
  { semantic: "PADDING", format: "uint32x3", offsetBytes: 20 },
];

export async function assembleResearchCourtyardScene({
  recipe,
  geometriesBySource,
  textureCatalog: catalogValue,
}) {
  if (!recipe || !Array.isArray(recipe.meshSources) || !Array.isArray(recipe.architecture))
    fail("recipe", "requires meshSources and architecture");
  const catalog = textureCatalog(catalogValue);
  const materialMap = new Map();
  const drawables = [
    ...modelDrawables(recipe, geometriesBySource, catalog, materialMap),
    ...architectureDrawables(recipe, catalog, materialMap),
  ].sort((left, right) => left.id.localeCompare(right.id));
  if (drawables.length === 0) fail("scene", "contains no drawables");
  const materials = [...materialMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, material]) => material);
  const materialIndices = new Map(materials.map((material, index) => [material.id, index]));
  const instances = [];
  const primitives = [];
  const renderPasses = {
    deferredOpaque: [],
    alphaMaskForward: [],
  };

  drawables.forEach((drawable, meshIndex) => {
    const instanceOffset = instances.length;
    const materialIndex = materialIndices.get(drawable.materialKey);
    if (materialIndex === undefined) fail(drawable.materialKey, "has no material index");
    for (const recipeInstance of drawable.instances) {
      const currentTransform = transformFor(recipeInstance);
      const animation = recipeInstance.animation
        ? {
            kind: recipeInstance.animation.kind,
            radiansPerSecond: recipeInstance.animation.radiansPerSecond,
            phaseRadians: recipeInstance.animation.phaseRadians,
          }
        : null;
      const flags = animation ? animatedInstanceFlag : 0;
      const instance = {
        id: `${recipeInstance.instanceId}:${meshIndex}`,
        currentTransform,
        previousTransform: [...currentTransform],
        materialIndex,
        meshIndex,
        flags,
        worldSphere: worldSphere(drawable.localBounds, currentTransform, recipeInstance.scale),
        animation,
      };
      const instanceIndex = instances.length;
      instances.push(instance);
      renderPasses[drawable.renderPass].push(instanceIndex);
    }
    const instanceCount = instances.length - instanceOffset;
    drawable.levels.forEach((level, lod) => {
      const drawn = level.state === "draw";
      primitives.push({
        meshIndex,
        lod,
        state: level.state,
        lodPolicy: drawable.lodPolicy,
        materialIndex,
        vertices: drawn ? vertexObjects(level.primitive) : [],
        indices: drawn ? [...level.primitive.indices] : [],
        relativeError: drawable.lodPolicy === "preserved" ? 0 : level.relativeError,
        instanceOffset,
        indirect: {
          instanceCount: drawn ? instanceCount : 0,
          firstInstance: 0,
        },
      });
    });
  });

  const encoded = encodeResearchCourtyardBinary({
    textureCount: catalog.textures.length,
    materials: materials.map(binaryMaterial),
    instances,
    primitives,
  });
  const compressed = await compressResearchCourtyardBuffers(encoded.buffers);
  const bufferDescriptor = (name) => {
    const record = compressed.manifest.records[name];
    return {
      uri: `courtyard/${name}.meshopt`,
      bytes: record.decodedBytes,
      encoding: {
        codec: record.codec,
        codecVersion: record.codecVersion,
        encoderLevel: record.encoderLevel,
        mode: record.mode,
        count: record.count,
        stride: record.stride,
        encodedBytes: record.encodedBytes,
        encodedSha256: record.encodedSha256,
        sourceSha256: record.sourceSha256,
        decodedSha256: record.decodedSha256,
        parity: record.parity,
      },
    };
  };
  const meshes = encoded.metadata.meshes.map((mesh, meshIndex) => ({
    id: drawables[meshIndex].id,
    lodPolicy: mesh.lodPolicy,
    lods: mesh.lods.map((lod) => ({
      state: lod.state,
      baseVertex: lod.baseVertex,
      firstIndex: lod.firstIndex,
      indexCount: lod.indexCount,
      vertexCount: lod.vertexCount,
      relativeError: lod.relativeError,
      indirectByteOffset: lod.indirectByteOffset,
      instanceOffset: lod.instanceOffset,
      instanceCount: lod.instanceCount,
    })),
  }));
  const pack = {
    format: "graphics-portfolio-packed-scene",
    version: 2,
    placeholder: false,
    coordinateSystem: "right-handed-y-up-meters",
    indexFormat: "uint32",
    vertexLayout: { strideBytes: VERTEX_STRIDE, attributes: vertexLayout },
    materialLayout: { strideBytes: MATERIAL_STRIDE, attributes: materialLayout },
    instanceLayout: { strideBytes: INSTANCE_STRIDE, attributes: instanceLayout },
    indirectCommandLayout: {
      strideBytes: INDEXED_INDIRECT_STRIDE,
      attributes: indirectLayout,
    },
    meshes,
    materials,
    instances,
    renderPasses,
    transport: {
      vertices: {
        ...bufferDescriptor("vertices"),
      },
      indices: {
        ...bufferDescriptor("indices"),
      },
      materials: {
        ...bufferDescriptor("materials"),
      },
      instances: {
        ...bufferDescriptor("instances"),
      },
      indirect: {
        ...bufferDescriptor("indirect"),
      },
      textures: catalog.textures,
    },
  };
  return {
    format: researchCourtyardSceneFormat,
    version: researchCourtyardSceneVersion,
    pack,
    buffers: encoded.buffers,
    encodedBuffers: compressed.buffers,
    meshopt: compressed.manifest,
    counts: {
      meshes: meshes.length,
      materials: materials.length,
      instances: instances.length,
      architectureMeshes: recipe.architecture.length,
      modelMeshes: meshes.length - recipe.architecture.length,
      animatedInstances: instances.filter((instance) => instance.animation !== null).length,
    },
  };
}
