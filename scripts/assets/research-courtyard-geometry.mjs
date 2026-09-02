import { NodeIO, Primitive } from "@gltf-transform/core";
import { KHRTextureTransform } from "@gltf-transform/extensions";

export const GLTF_TRANSFORM_VERSION = "4.4.2";
export const RESEARCH_COURTYARD_GEOMETRY_FORMAT = "graphics-portfolio-research-courtyard-geometry";
export const RESEARCH_COURTYARD_GEOMETRY_VERSION = 1;

const TRIANGLES = Primitive.Mode.TRIANGLES;
const EPSILON = 1e-12;
const TRANSFORM_EPSILON = 1e-6;
const ROUNDING_DIGITS = 7;
const FENCE_SOURCE_ID = "modular-chainlink-fence";
const FENCE_WIRE_MATERIAL = "modular_chainlink_fence_wire";

export class ResearchCourtyardGeometryError extends Error {
  constructor(pathname, message) {
    super(`${pathname}: ${message}`);
    this.name = "ResearchCourtyardGeometryError";
    this.path = pathname;
  }
}

function fail(pathname, message) {
  throw new ResearchCourtyardGeometryError(pathname, message);
}

function round(value) {
  const result = Number(value.toFixed(ROUNDING_DIGITS));
  return Object.is(result, -0) ? 0 : result;
}

function rounded(values) {
  return values.map((value) => round(value));
}

function plainArray(array, pathname) {
  if (!array || typeof array.length !== "number") fail(pathname, "has no decoded accessor array");
  return Array.from(array, (value) => {
    if (!Number.isFinite(value)) fail(pathname, "contains a non-finite value");
    return value;
  });
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function comparePrimitive(left, right) {
  return (
    compareText(left.sourceId, right.sourceId) ||
    compareText(left.partId, right.partId) ||
    compareText(left.nodeName, right.nodeName) ||
    left.primitiveIndex - right.primitiveIndex
  );
}

function identityTransform() {
  return {
    offset: [0, 0],
    rotation: 0,
    scale: [1, 1],
    texCoord: 0,
    extension: false,
  };
}

function sameTransform(left, right) {
  return (
    left.texCoord === right.texCoord &&
    Math.abs(left.rotation - right.rotation) <= TRANSFORM_EPSILON &&
    left.offset.every(
      (value, index) => Math.abs(value - right.offset[index]) <= TRANSFORM_EPSILON,
    ) &&
    left.scale.every((value, index) => Math.abs(value - right.scale[index]) <= TRANSFORM_EPSILON)
  );
}

function transformFromTextureInfo(textureInfo, pathname) {
  if (!textureInfo) return identityTransform();
  const extension = textureInfo.getExtension("KHR_texture_transform");
  const transform = extension
    ? {
        offset: Array.from(extension.getOffset()),
        rotation: extension.getRotation(),
        scale: Array.from(extension.getScale()),
        texCoord: extension.getTexCoord() ?? textureInfo.getTexCoord(),
        extension: true,
      }
    : { ...identityTransform(), texCoord: textureInfo.getTexCoord() };
  if (
    transform.texCoord !== 0 ||
    transform.offset.length !== 2 ||
    transform.scale.length !== 2 ||
    !transform.offset.every(Number.isFinite) ||
    !transform.scale.every(Number.isFinite) ||
    !Number.isFinite(transform.rotation)
  )
    fail(pathname, "requires a finite KHR_texture_transform using TEXCOORD_0");
  return transform;
}

function materialTransform(material, pathname) {
  if (!material) return identityTransform();
  const slots = [
    ["baseColor", material.getBaseColorTextureInfo(), material.getBaseColorTexture()],
    ["normal", material.getNormalTextureInfo(), material.getNormalTexture()],
    [
      "metallicRoughness",
      material.getMetallicRoughnessTextureInfo(),
      material.getMetallicRoughnessTexture(),
    ],
    ["occlusion", material.getOcclusionTextureInfo(), material.getOcclusionTexture()],
    ["emissive", material.getEmissiveTextureInfo(), material.getEmissiveTexture()],
  ];
  const transforms = slots
    .filter(([, info, texture]) => texture || info?.getExtension("KHR_texture_transform"))
    .map(([name, info]) => transformFromTextureInfo(info, `${pathname}.${name}`));
  if (transforms.length === 0) return identityTransform();
  if (transforms.some((transform) => !sameTransform(transform, transforms[0])))
    fail(pathname, "uses texture slots with incompatible UV transforms");
  return transforms[0];
}

function bakeUv(uvs, transform) {
  if (!transform.extension) return [...uvs];
  const cos = Math.cos(transform.rotation);
  const sin = Math.sin(transform.rotation);
  const output = new Array(uvs.length);
  for (let index = 0; index < uvs.length; index += 2) {
    const u = uvs[index] * transform.scale[0];
    const v = uvs[index + 1] * transform.scale[1];
    output[index] = cos * u - sin * v + transform.offset[0];
    output[index + 1] = sin * u + cos * v + transform.offset[1];
  }
  return output;
}

function materialMetadata(material, transform) {
  const textureTransform = transform.extension
    ? {
        offset: rounded(transform.offset),
        rotation: round(transform.rotation),
        scale: rounded(transform.scale),
        texCoord: transform.texCoord,
        bakedIntoUv: true,
      }
    : null;
  if (!material)
    return {
      name: null,
      alphaMode: "OPAQUE",
      alphaCutoff: 0.5,
      doubleSided: false,
      baseColorFactor: [1, 1, 1, 1],
      metallicFactor: 1,
      roughnessFactor: 1,
      textureTransform,
    };
  return {
    name: material.getName() || null,
    alphaMode: material.getAlphaMode(),
    alphaCutoff: round(material.getAlphaCutoff()),
    doubleSided: material.getDoubleSided(),
    baseColorFactor: rounded(Array.from(material.getBaseColorFactor())),
    metallicFactor: round(material.getMetallicFactor()),
    roughnessFactor: round(material.getRoughnessFactor()),
    textureTransform,
  };
}

function assertFenceTransform(meshSource, material, transform, pathname) {
  if (meshSource.sourceId !== FENCE_SOURCE_ID || material?.getName() !== FENCE_WIRE_MATERIAL)
    return;
  const override = meshSource.materialOverrides?.find(
    (entry) => entry?.materialName === FENCE_WIRE_MATERIAL,
  );
  if (override?.textureTransform?.bakeIntoUv !== true)
    fail(pathname, "fence wire requires a recipe-declared UV bake");
  if (!transform.extension)
    fail(pathname, "fence wire requires KHR_texture_transform baked into TEXCOORD_0");
  const expected = override.textureTransform;
  if (
    !sameTransform(transform, {
      offset: expected.offset,
      rotation: expected.rotation,
      scale: expected.scale,
      texCoord: 0,
    })
  )
    fail(pathname, "fence wire transform differs from the recipe receipt");
}

function validateMeshSource(meshSource) {
  if (!meshSource || typeof meshSource !== "object") fail("meshSource", "must be an object");
  if (typeof meshSource.sourceId !== "string" || !meshSource.sourceId)
    fail("meshSource.sourceId", "must be non-empty");
  if (!Array.isArray(meshSource.parts) || meshSource.parts.length === 0)
    fail("meshSource.parts", "must contain selected parts");
  const partIds = new Set();
  const nodeNames = new Set();
  for (const [index, part] of meshSource.parts.entries()) {
    const pathname = `meshSource.parts[${index}]`;
    if (typeof part?.partId !== "string" || !part.partId || partIds.has(part.partId))
      fail(`${pathname}.partId`, "must be unique and non-empty");
    partIds.add(part.partId);
    if (!Array.isArray(part.nodeNames) || part.nodeNames.length === 0)
      fail(`${pathname}.nodeNames`, "must be non-empty");
    for (const nodeName of part.nodeNames) {
      if (typeof nodeName !== "string" || !nodeName || nodeNames.has(nodeName))
        fail(`${pathname}.nodeNames`, "must contain globally unique names");
      nodeNames.add(nodeName);
    }
  }
}

function assertDocumentScope(document) {
  const root = document?.getRoot?.();
  if (!root) fail("gltf", "did not load a glTF Transform document");
  if (root.listAnimations().length) fail("gltf.animations", "animations are unsupported");
  if (root.listSkins().length) fail("gltf.skins", "skins are unsupported");
  return root;
}

function selectedNodes(root, names) {
  const output = new Map();
  for (const node of root.listNodes()) {
    const name = node.getName();
    if (!names.has(name)) continue;
    if (output.has(name)) fail(`gltf.nodes.${name}`, "selected node name is ambiguous");
    output.set(name, node);
  }
  for (const name of names)
    if (!output.has(name)) fail(`gltf.nodes.${name}`, "recipe-selected node is absent");
  return output;
}

function nodeMatrix(node, pathname) {
  const matrix = Array.from(node.getWorldMatrix());
  if (matrix.length !== 16 || !matrix.every(Number.isFinite))
    fail(pathname, "has an invalid world matrix");
  return matrix;
}

function normalMatrix(matrix, pathname) {
  const [a00, a10, a20] = [matrix[0], matrix[1], matrix[2]];
  const [a01, a11, a21] = [matrix[4], matrix[5], matrix[6]];
  const [a02, a12, a22] = [matrix[8], matrix[9], matrix[10]];
  const determinant =
    a00 * (a11 * a22 - a12 * a21) - a01 * (a10 * a22 - a12 * a20) + a02 * (a10 * a21 - a11 * a20);
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= EPSILON)
    fail(pathname, "has a singular world matrix");
  return {
    determinant,
    values: [
      (a11 * a22 - a12 * a21) / determinant,
      (a12 * a20 - a10 * a22) / determinant,
      (a10 * a21 - a11 * a20) / determinant,
      (a02 * a21 - a01 * a22) / determinant,
      (a00 * a22 - a02 * a20) / determinant,
      (a01 * a20 - a00 * a21) / determinant,
      (a01 * a12 - a02 * a11) / determinant,
      (a02 * a10 - a00 * a12) / determinant,
      (a00 * a11 - a01 * a10) / determinant,
    ],
  };
}

function unit(x, y, z, pathname) {
  const length = Math.hypot(x, y, z);
  if (!Number.isFinite(length) || length <= EPSILON)
    fail(pathname, "contains a zero-length vector");
  return [x / length, y / length, z / length];
}

function transformPositions(values, matrix, pathname) {
  const output = new Array(values.length);
  for (let index = 0; index < values.length; index += 3) {
    const [x, y, z] = values.slice(index, index + 3);
    const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
    if (!Number.isFinite(w) || Math.abs(w) <= EPSILON)
      fail(pathname, "produces an invalid homogeneous coordinate");
    output[index] = (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w;
    output[index + 1] = (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w;
    output[index + 2] = (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / w;
  }
  return output;
}

function transformNormals(values, matrix, pathname) {
  const matrix3 = normalMatrix(matrix, pathname);
  const output = new Array(values.length);
  for (let index = 0; index < values.length; index += 3) {
    const [x, y, z] = values.slice(index, index + 3);
    const normalized = unit(
      matrix3.values[0] * x + matrix3.values[1] * y + matrix3.values[2] * z,
      matrix3.values[3] * x + matrix3.values[4] * y + matrix3.values[5] * z,
      matrix3.values[6] * x + matrix3.values[7] * y + matrix3.values[8] * z,
      pathname,
    );
    output[index] = normalized[0];
    output[index + 1] = normalized[1];
    output[index + 2] = normalized[2];
  }
  return { values: output, determinant: matrix3.determinant };
}

function indicesFor(primitive, vertexCount, pathname) {
  const accessor = primitive.getIndices();
  const indices = accessor
    ? plainArray(accessor.getArray(), `${pathname}.indices`)
    : Array.from({ length: vertexCount }, (_, index) => index);
  if (!indices.length || indices.length % 3) fail(`${pathname}.indices`, "must contain triangles");
  for (const [index, value] of indices.entries())
    if (!Number.isSafeInteger(value) || value < 0 || value >= vertexCount)
      fail(`${pathname}.indices[${index}]`, "is outside the vertex range");
  return indices;
}

function fallbackTangent(normal) {
  const axis = Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  return unit(
    axis[1] * normal[2] - axis[2] * normal[1],
    axis[2] * normal[0] - axis[0] * normal[2],
    axis[0] * normal[1] - axis[1] * normal[0],
    "tangent fallback",
  );
}

function generateTangents(positions, normals, uvs, indices) {
  const count = positions.length / 3;
  const tan1 = Array.from({ length: count }, () => [0, 0, 0]);
  const tan2 = Array.from({ length: count }, () => [0, 0, 0]);
  let fallback = false;
  for (let index = 0; index < indices.length; index += 3) {
    const [i0, i1, i2] = indices.slice(index, index + 3);
    const p = [i0, i1, i2].map((vertex) => positions.slice(vertex * 3, vertex * 3 + 3));
    const uv = [i0, i1, i2].map((vertex) => uvs.slice(vertex * 2, vertex * 2 + 2));
    const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
    const e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    const du1 = uv[1][0] - uv[0][0];
    const dv1 = uv[1][1] - uv[0][1];
    const du2 = uv[2][0] - uv[0][0];
    const dv2 = uv[2][1] - uv[0][1];
    const determinant = du1 * dv2 - du2 * dv1;
    if (!Number.isFinite(determinant) || Math.abs(determinant) <= EPSILON) {
      fallback = true;
      continue;
    }
    const reciprocal = 1 / determinant;
    const s = [
      (e1[0] * dv2 - e2[0] * dv1) * reciprocal,
      (e1[1] * dv2 - e2[1] * dv1) * reciprocal,
      (e1[2] * dv2 - e2[2] * dv1) * reciprocal,
    ];
    const t = [
      (e2[0] * du1 - e1[0] * du2) * reciprocal,
      (e2[1] * du1 - e1[1] * du2) * reciprocal,
      (e2[2] * du1 - e1[2] * du2) * reciprocal,
    ];
    for (const vertex of [i0, i1, i2])
      for (let component = 0; component < 3; component += 1) {
        tan1[vertex][component] += s[component];
        tan2[vertex][component] += t[component];
      }
  }
  const output = new Array(count * 4);
  for (let vertex = 0; vertex < count; vertex += 1) {
    const normal = normals.slice(vertex * 3, vertex * 3 + 3);
    const dot =
      normal[0] * tan1[vertex][0] + normal[1] * tan1[vertex][1] + normal[2] * tan1[vertex][2];
    let tangent = [
      tan1[vertex][0] - normal[0] * dot,
      tan1[vertex][1] - normal[1] * dot,
      tan1[vertex][2] - normal[2] * dot,
    ];
    const length = Math.hypot(...tangent);
    if (!Number.isFinite(length) || length <= EPSILON) {
      tangent = fallbackTangent(normal);
      fallback = true;
    } else tangent = tangent.map((value) => value / length);
    const cross = [
      normal[1] * tangent[2] - normal[2] * tangent[1],
      normal[2] * tangent[0] - normal[0] * tangent[2],
      normal[0] * tangent[1] - normal[1] * tangent[0],
    ];
    const handedness =
      cross[0] * tan2[vertex][0] + cross[1] * tan2[vertex][1] + cross[2] * tan2[vertex][2] < 0
        ? -1
        : 1;
    output[vertex * 4] = tangent[0];
    output[vertex * 4 + 1] = tangent[1];
    output[vertex * 4 + 2] = tangent[2];
    output[vertex * 4 + 3] = handedness;
  }
  return { values: output, fallback };
}

function validatePrimitive(primitive, pathname) {
  if (primitive.getMode() !== TRIANGLES) fail(`${pathname}.mode`, "must be TRIANGLES");
  if (primitive.listTargets().length) fail(`${pathname}.targets`, "morph targets are unsupported");
  const position = primitive.getAttribute("POSITION");
  const normal = primitive.getAttribute("NORMAL");
  const uv = primitive.getAttribute("TEXCOORD_0");
  if (!position || !normal || !uv)
    fail(`${pathname}.attributes`, "requires POSITION, NORMAL, and TEXCOORD_0");
  if (position.getType() !== "VEC3" || normal.getType() !== "VEC3" || uv.getType() !== "VEC2")
    fail(`${pathname}.attributes`, "requires POSITION/NORMAL VEC3 and TEXCOORD_0 VEC2");
  const positions = plainArray(position.getArray(), `${pathname}.POSITION`);
  const normals = plainArray(normal.getArray(), `${pathname}.NORMAL`);
  const uvs = plainArray(uv.getArray(), `${pathname}.TEXCOORD_0`);
  const count = positions.length / 3;
  if (
    !count ||
    positions.length % 3 ||
    normals.length !== positions.length ||
    uvs.length !== count * 2
  )
    fail(`${pathname}.attributes`, "has incompatible accessor counts");
  return { positions, normals, uvs, count };
}

function bounds(primitives) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const primitive of primitives)
    for (let index = 0; index < primitive.positions.length; index += 3)
      for (let component = 0; component < 3; component += 1) {
        min[component] = Math.min(min[component], primitive.positions[index + component]);
        max[component] = Math.max(max[component], primitive.positions[index + component]);
      }
  if (!min.every(Number.isFinite) || !max.every(Number.isFinite)) fail("bounds", "has no vertices");
  return {
    min,
    max,
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
  };
}

function serialBounds(value) {
  return {
    min: rounded(value.min),
    max: rounded(value.max),
    center: rounded(value.center),
    size: rounded(value.size),
  };
}

function groundCenter(primitives) {
  const source = bounds(primitives);
  const translation = [-source.center[0], -source.min[1], -source.center[2]];
  for (const primitive of primitives)
    for (let index = 0; index < primitive.positions.length; index += 3) {
      primitive.positions[index] += translation[0];
      primitive.positions[index + 1] += translation[1];
      primitive.positions[index + 2] += translation[2];
    }
  return {
    mode: "ground-center",
    translation: rounded(translation),
    sourceBounds: serialBounds(source),
  };
}

function normalizePrimitive(meshSource, partId, nodeName, node, primitive, primitiveIndex) {
  const pathname = `${meshSource.sourceId}/${partId}/${nodeName}/${primitiveIndex}`;
  const mesh = node.getMesh();
  if (!mesh) fail(`${pathname}.mesh`, "selected node has no mesh");
  if (node.getSkin()) fail(`${pathname}.skin`, "skins are unsupported");
  if (mesh.getWeights().length) fail(`${pathname}.weights`, "morph weights are unsupported");
  const attributes = validatePrimitive(primitive, pathname);
  const matrix = nodeMatrix(node, `${pathname}.worldMatrix`);
  const positions = transformPositions(attributes.positions, matrix, `${pathname}.POSITION`);
  const transformedNormals = transformNormals(attributes.normals, matrix, `${pathname}.NORMAL`);
  const material = primitive.getMaterial();
  const transform = materialTransform(material, `${pathname}.material`);
  assertFenceTransform(meshSource, material, transform, `${pathname}.material`);
  const indices = indicesFor(primitive, attributes.count, pathname);
  if (transformedNormals.determinant < 0)
    for (let index = 0; index < indices.length; index += 3)
      [indices[index + 1], indices[index + 2]] = [indices[index + 2], indices[index + 1]];
  const uvs = bakeUv(attributes.uvs, transform);
  const tangent = generateTangents(positions, transformedNormals.values, uvs, indices);
  return {
    sourceId: meshSource.sourceId,
    partId,
    nodeName,
    primitiveIndex,
    nodeWorldMatrix: rounded(matrix),
    windingFlipped: transformedNormals.determinant < 0,
    positions,
    normals: transformedNormals.values,
    tangents: tangent.values,
    tangentFallback: tangent.fallback,
    uvs,
    indices,
    material: materialMetadata(material, transform),
  };
}

function serialPrimitive(primitive) {
  return {
    ...primitive,
    positions: rounded(primitive.positions),
    normals: rounded(primitive.normals),
    tangents: rounded(primitive.tangents),
    uvs: rounded(primitive.uvs),
    indices: [...primitive.indices],
  };
}

export function normalizeResearchCourtyardMeshDocument(meshSource, document) {
  validateMeshSource(meshSource);
  const root = assertDocumentScope(document);
  const names = new Set(meshSource.parts.flatMap((part) => part.nodeNames));
  const nodes = selectedNodes(root, names);
  const records = [];
  for (const part of meshSource.parts)
    for (const nodeName of part.nodeNames) {
      const node = nodes.get(nodeName);
      const mesh = node.getMesh();
      if (!mesh)
        fail(`${meshSource.sourceId}/${part.partId}/${nodeName}`, "selected node has no mesh");
      for (const [primitiveIndex, primitive] of mesh.listPrimitives().entries())
        records.push(
          normalizePrimitive(meshSource, part.partId, nodeName, node, primitive, primitiveIndex),
        );
    }
  records.sort(comparePrimitive);
  if (!records.length) fail(meshSource.sourceId, "selected nodes produced no primitives");
  const parts = [...meshSource.parts]
    .sort((left, right) => compareText(left.partId, right.partId))
    .map((part) => {
      const primitives = records.filter((record) => record.partId === part.partId);
      if (!primitives.length)
        fail(`${meshSource.sourceId}/${part.partId}`, "produced no primitives");
      const normalization = groundCenter(primitives);
      return {
        partId: part.partId,
        normalization,
        bounds: serialBounds(bounds(primitives)),
        primitives: primitives.map(serialPrimitive),
      };
    });
  return {
    format: RESEARCH_COURTYARD_GEOMETRY_FORMAT,
    version: RESEARCH_COURTYARD_GEOMETRY_VERSION,
    sourceId: meshSource.sourceId,
    parts,
  };
}

export async function normalizeReviewedMeshSource(meshSource, reviewedGltfPath, options = {}) {
  if (typeof reviewedGltfPath !== "string" || !reviewedGltfPath)
    fail("reviewedGltfPath", "must be a non-empty local glTF path");
  const io = options.io ?? new NodeIO().registerExtensions([KHRTextureTransform]);
  return normalizeResearchCourtyardMeshDocument(meshSource, await io.read(reviewedGltfPath));
}
