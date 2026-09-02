import { createHash } from "node:crypto";

export const VERTEX_STRIDE = 32;
export const INDEX_STRIDE = 4;
export const MATERIAL_STRIDE = 64;
export const INSTANCE_STRIDE = 128;
export const INDEXED_INDIRECT_STRIDE = 32;
export const NO_TEXTURE = 0xffffffff;

const UINT32_MAX = 0xffffffff;
const INT32_MAX = 0x7fffffff;
const FLOAT16_MAX = 65504;
const FLOAT32_SCRATCH = new DataView(new ArrayBuffer(4));

function fail(message) {
  throw new TypeError(`Research Courtyard binary: ${message}`);
}

function requireRecord(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail(`${label} must be an object.`);
  return value;
}

function requireList(value, label) {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value))
    fail(`${label} must be an array or typed array.`);
  return Array.from(value);
}

function requireFinite(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value))
    fail(`${label} must be a finite number.`);
  return value;
}

function requireUint(value, label, maximum = UINT32_MAX) {
  if (!Number.isInteger(value) || value < 0 || value > maximum)
    fail(`${label} must be an unsigned integer in [0, ${maximum}].`);
  return value;
}

function requireInt32(value, label) {
  if (!Number.isInteger(value) || value < -0x80000000 || value > INT32_MAX)
    fail(`${label} must be a signed 32-bit integer.`);
  return value;
}

function requireVector(value, count, label) {
  const values = requireList(value, label);
  if (values.length !== count) fail(`${label} must contain exactly ${count} values.`);
  return values.map((component, index) => requireFinite(component, `${label}[${index}]`));
}

function requireUnit(value, label) {
  const result = requireFinite(value, label);
  if (result < -1 || result > 1) fail(`${label} must be in [-1, 1].`);
  return result;
}

function requireUnitInterval(value, label) {
  const result = requireFinite(value, label);
  if (result < 0 || result > 1) fail(`${label} must be in [0, 1].`);
  return result;
}

function normalizeDirection(value, label) {
  const direction = requireVector(value, 3, label);
  const length = Math.hypot(direction[0], direction[1], direction[2]);
  if (!Number.isFinite(length) || length <= Number.EPSILON)
    fail(`${label} must have non-zero length.`);
  return direction.map((component) => component / length);
}

function byteView(buffer, label) {
  if (buffer instanceof ArrayBuffer) return new Uint8Array(buffer);
  if (ArrayBuffer.isView(buffer))
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  fail(`${label} must be an ArrayBuffer or typed-array view.`);
}

function dataView(buffer, label) {
  const bytes = byteView(buffer, label);
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function assertStride(bytes, stride, label) {
  if (bytes.byteLength % stride !== 0)
    fail(`${label} length must be a multiple of ${stride} bytes.`);
}

function checkedByteLength(count, stride, label) {
  const byteLength = count * stride;
  if (!Number.isSafeInteger(byteLength) || byteLength < 0)
    fail(`${label} byte length is not representable.`);
  return byteLength;
}

function sha256(buffer) {
  return createHash("sha256").update(byteView(buffer, "hash input")).digest("hex");
}

function zeroRange(view, offset, length, label) {
  for (let index = offset; index < offset + length; index += 1)
    if (view.getUint8(index) !== 0) fail(`${label} reserved padding must be zero.`);
}

function textureIndex(value, label, textureCount) {
  if (value === undefined || value === null) return NO_TEXTURE;
  const index = requireUint(value, label);
  if (textureCount !== undefined && index >= textureCount)
    fail(`${label} references texture ${index}, but textureCount is ${textureCount}.`);
  return index;
}

function materialFlags(alphaMode, doubleSided, label) {
  const mode =
    typeof (alphaMode ?? "OPAQUE") === "string" ? (alphaMode ?? "OPAQUE").toUpperCase() : "";
  if (mode !== "OPAQUE" && mode !== "MASK") fail(`${label} must be OPAQUE or MASK.`);
  if (doubleSided !== undefined && typeof doubleSided !== "boolean")
    fail(`${label.replace("alphaMode", "doubleSided")} must be boolean.`);
  return (mode === "MASK" ? 1 : 0) | (doubleSided === true ? 2 : 0);
}

/** Packs a finite number as IEEE-754 binary16 with round-to-nearest-even. */
export function packFloat16(value) {
  requireFinite(value, "float16 value");
  if (Math.abs(value) > FLOAT16_MAX)
    fail(`float16 value ${value} exceeds the finite binary16 range.`);
  FLOAT32_SCRATCH.setFloat32(0, value, true);
  const bits = FLOAT32_SCRATCH.getUint32(0, true);
  const sign = (bits >>> 16) & 0x8000;
  const exponent = (bits >>> 23) & 0xff;
  const fraction = bits & 0x7fffff;
  if (exponent === 0xff) fail("float16 value became non-finite after float32 conversion.");
  if (exponent === 0 || exponent < 102) return sign;
  if (exponent < 113) {
    const mantissa = fraction | 0x800000;
    const shift = 126 - exponent;
    const divisor = 2 ** shift;
    let packed = Math.floor(mantissa / divisor);
    const remainder = mantissa - packed * divisor;
    if (remainder * 2 > divisor || (remainder * 2 === divisor && (packed & 1) === 1)) packed += 1;
    return sign | packed;
  }
  let packedExponent = exponent - 112;
  let packedFraction = fraction >>> 13;
  const remainder = fraction & 0x1fff;
  if (remainder > 0x1000 || (remainder === 0x1000 && (packedFraction & 1) === 1)) {
    packedFraction += 1;
    if (packedFraction === 0x400) {
      packedFraction = 0;
      packedExponent += 1;
    }
  }
  if (packedExponent >= 0x1f) fail(`float16 value ${value} rounds to binary16 infinity.`);
  return sign | (packedExponent << 10) | packedFraction;
}

export function unpackFloat16(bits) {
  requireUint(bits, "float16 bits", 0xffff);
  const sign = (bits & 0x8000) === 0 ? 1 : -1;
  const exponent = (bits >>> 10) & 0x1f;
  const fraction = bits & 0x03ff;
  if (exponent === 0) return sign * fraction * 2 ** -24;
  if (exponent === 0x1f) return fraction === 0 ? sign * Number.POSITIVE_INFINITY : Number.NaN;
  return sign * (1 + fraction / 0x400) * 2 ** (exponent - 15);
}

export function packSnorm16(value) {
  const normalized = requireUnit(value, "snorm16 value");
  return normalized <= -1 ? -0x8000 : Math.round(normalized * 0x7fff);
}

export function unpackSnorm16(value) {
  if (!Number.isInteger(value) || value < -0x8000 || value > 0x7fff)
    fail("snorm16 input must be a signed 16-bit integer.");
  return value === -0x8000 ? -1 : value / 0x7fff;
}

/** @returns {[number, number]} */
export function packOctSnorm16(normal) {
  const [nx, ny, nz] = normalizeDirection(normal, "normal");
  const reciprocalLength = 1 / (Math.abs(nx) + Math.abs(ny) + Math.abs(nz));
  let x = nx * reciprocalLength;
  let y = ny * reciprocalLength;
  if (nz < 0) {
    const previousX = x;
    x = (1 - Math.abs(y)) * Math.sign(previousX || 1);
    y = (1 - Math.abs(previousX)) * Math.sign(y || 1);
  }
  return [packSnorm16(x), packSnorm16(y)];
}

export function unpackOctSnorm16([packedX, packedY]) {
  let x = unpackSnorm16(packedX);
  let y = unpackSnorm16(packedY);
  let z = 1 - Math.abs(x) - Math.abs(y);
  if (z < 0) {
    const previousX = x;
    x = (1 - Math.abs(y)) * Math.sign(previousX || 1);
    y = (1 - Math.abs(previousX)) * Math.sign(y || 1);
  }
  const length = Math.hypot(x, y, z);
  if (length <= Number.EPSILON) fail("octahedral normal decodes to zero.");
  return [x / length, y / length, z / length];
}

export function packTangentSnorm16x4(tangent) {
  const values = requireVector(tangent, 4, "tangent");
  if (Math.abs(values[3]) !== 1) fail("tangent handedness must be exactly -1 or 1.");
  const xyz = normalizeDirection(values.slice(0, 3), "tangent.xyz");
  return [packSnorm16(xyz[0]), packSnorm16(xyz[1]), packSnorm16(xyz[2]), packSnorm16(values[3])];
}

export function unpackTangentSnorm16x4(packed) {
  const values = requireList(packed, "packed tangent");
  if (values.length !== 4) fail("packed tangent must have four components.");
  return values.map((value) => unpackSnorm16(value));
}

function normalizeVertex(vertex, label) {
  const source = requireRecord(vertex, label);
  const uv = requireVector(source.uv, 2, `${label}.uv`);
  return {
    position: requireVector(source.position, 3, `${label}.position`),
    normal: packOctSnorm16(source.normal),
    tangent: packTangentSnorm16x4(source.tangent),
    uv: [packFloat16(uv[0]), packFloat16(uv[1])],
  };
}

function writeVertex(view, offset, vertex) {
  view.setFloat32(offset + 0, vertex.position[0], true);
  view.setFloat32(offset + 4, vertex.position[1], true);
  view.setFloat32(offset + 8, vertex.position[2], true);
  view.setInt16(offset + 12, vertex.normal[0], true);
  view.setInt16(offset + 14, vertex.normal[1], true);
  view.setInt16(offset + 16, vertex.tangent[0], true);
  view.setInt16(offset + 18, vertex.tangent[1], true);
  view.setInt16(offset + 20, vertex.tangent[2], true);
  view.setInt16(offset + 22, vertex.tangent[3], true);
  view.setUint16(offset + 24, vertex.uv[0], true);
  view.setUint16(offset + 26, vertex.uv[1], true);
}

function normalizeMaterial(material, index, textureCount) {
  const source = requireRecord(material, `materials[${index}]`);
  const baseColor = requireVector(
    source.baseColor ?? [1, 1, 1, 1],
    4,
    `materials[${index}].baseColor`,
  ).map((value, component) =>
    requireUnitInterval(value, `materials[${index}].baseColor[${component}]`),
  );
  const emissive = requireVector(
    source.emissive ?? [0, 0, 0],
    3,
    `materials[${index}].emissive`,
  ).map((value, component) => {
    if (value < 0) fail(`materials[${index}].emissive[${component}] must not be negative.`);
    return value;
  });
  const normalScale = requireFinite(source.normalScale ?? 1, `materials[${index}].normalScale`);
  if (normalScale < 0) fail(`materials[${index}].normalScale must not be negative.`);
  return {
    baseColor,
    emissive,
    metallic: requireUnitInterval(source.metallic ?? 0, `materials[${index}].metallic`),
    roughness: requireUnitInterval(source.roughness ?? 1, `materials[${index}].roughness`),
    alphaCutoff: requireUnitInterval(source.alphaCutoff ?? 0.5, `materials[${index}].alphaCutoff`),
    normalScale,
    flags: materialFlags(source.alphaMode, source.doubleSided, `materials[${index}].alphaMode`),
    baseColorTexture: textureIndex(
      source.baseColorTexture,
      `materials[${index}].baseColorTexture`,
      textureCount,
    ),
    normalTexture: textureIndex(
      source.normalTexture,
      `materials[${index}].normalTexture`,
      textureCount,
    ),
    ormTexture: textureIndex(source.ormTexture, `materials[${index}].ormTexture`, textureCount),
  };
}

function writeMaterial(view, offset, material) {
  view.setFloat32(offset + 0, material.baseColor[0], true);
  view.setFloat32(offset + 4, material.baseColor[1], true);
  view.setFloat32(offset + 8, material.baseColor[2], true);
  view.setFloat32(offset + 12, material.baseColor[3], true);
  view.setFloat32(offset + 16, material.emissive[0], true);
  view.setFloat32(offset + 20, material.emissive[1], true);
  view.setFloat32(offset + 24, material.emissive[2], true);
  view.setFloat32(offset + 28, material.metallic, true);
  view.setFloat32(offset + 32, material.roughness, true);
  view.setFloat32(offset + 36, material.alphaCutoff, true);
  view.setFloat32(offset + 40, material.normalScale, true);
  view.setUint32(offset + 44, material.flags, true);
  view.setUint32(offset + 48, material.baseColorTexture, true);
  view.setUint32(offset + 52, material.normalTexture, true);
  view.setUint32(offset + 56, material.ormTexture, true);
}

function normalizeInstance(instance, index, meshCount, materialCount) {
  const source = requireRecord(instance, `instances[${index}]`);
  const materialIndex = requireUint(source.materialIndex, `instances[${index}].materialIndex`);
  const meshIndex = requireUint(source.meshIndex, `instances[${index}].meshIndex`);
  if (materialIndex >= materialCount)
    fail(`instances[${index}].materialIndex ${materialIndex} is out of range.`);
  if (meshIndex >= meshCount) fail(`instances[${index}].meshIndex ${meshIndex} is out of range.`);
  const currentTransform = requireVector(
    source.currentTransform ?? source.transform,
    12,
    `instances[${index}].currentTransform`,
  );
  const previousTransform = requireVector(
    source.previousTransform ?? currentTransform,
    12,
    `instances[${index}].previousTransform`,
  );
  const worldSphere = requireVector(source.worldSphere, 4, `instances[${index}].worldSphere`);
  if (worldSphere[3] <= 0)
    fail(`instances[${index}].worldSphere radius must be greater than zero.`);
  return {
    materialIndex,
    meshIndex,
    currentTransform,
    previousTransform,
    flags: requireUint(source.flags ?? 0, `instances[${index}].flags`),
    worldSphere,
  };
}

function writeInstance(view, offset, instance) {
  for (let index = 0; index < 12; index += 1) {
    view.setFloat32(offset + index * 4, instance.currentTransform[index], true);
    view.setFloat32(offset + 48 + index * 4, instance.previousTransform[index], true);
  }
  view.setUint32(offset + 96, instance.materialIndex, true);
  view.setUint32(offset + 100, instance.meshIndex, true);
  view.setUint32(offset + 104, instance.flags, true);
  for (let index = 0; index < 4; index += 1)
    view.setFloat32(offset + 108 + index * 4, instance.worldSphere[index], true);
}

function normalizePrimitive(primitive, index, materialCount, instanceCount) {
  const source = requireRecord(primitive, `primitives[${index}]`);
  const meshIndex = requireUint(source.meshIndex, `primitives[${index}].meshIndex`);
  const lod = requireUint(source.lod, `primitives[${index}].lod`, 2);
  const lodPolicy = source.lodPolicy ?? "simplified";
  if (lodPolicy !== "simplified" && lodPolicy !== "preserved")
    fail(`primitives[${index}].lodPolicy must be simplified or preserved.`);
  const materialIndex = requireUint(source.materialIndex, `primitives[${index}].materialIndex`);
  if (materialIndex >= materialCount)
    fail(`primitives[${index}].materialIndex ${materialIndex} is out of range.`);
  const vertices = requireList(source.vertices, `primitives[${index}].vertices`);
  if (vertices.length === 0) fail(`primitives[${index}].vertices must not be empty.`);
  const normalizedVertices = vertices.map((vertex, vertexIndex) =>
    normalizeVertex(vertex, `primitives[${index}].vertices[${vertexIndex}]`),
  );
  const indices = requireList(source.indices, `primitives[${index}].indices`);
  if (indices.length === 0 || indices.length % 3 !== 0)
    fail(`primitives[${index}].indices must be a non-empty triangle list.`);
  const normalizedIndices = indices.map((value, indexIndex) => {
    const result = requireUint(value, `primitives[${index}].indices[${indexIndex}]`);
    if (result >= normalizedVertices.length)
      fail(`primitives[${index}].indices[${indexIndex}] exceeds local vertex count.`);
    return result;
  });
  const indirect = requireRecord(source.indirect ?? {}, `primitives[${index}].indirect`);
  const indirectInstanceCount = requireUint(
    indirect.instanceCount ?? 0,
    `primitives[${index}].indirect.instanceCount`,
  );
  const firstInstance = requireUint(
    indirect.firstInstance ?? 0,
    `primitives[${index}].indirect.firstInstance`,
  );
  if (firstInstance !== 0) fail(`primitives[${index}].indirect.firstInstance must be zero.`);
  if (firstInstance + indirectInstanceCount > instanceCount)
    fail(`primitives[${index}].indirect range exceeds instance buffer.`);
  const screenError = requireFinite(source.screenError ?? 0, `primitives[${index}].screenError`);
  if (screenError < 0) fail(`primitives[${index}].screenError must not be negative.`);
  return {
    meshIndex,
    lod,
    lodPolicy,
    materialIndex,
    vertices: normalizedVertices,
    indices: normalizedIndices,
    screenError,
    indirect: { instanceCount: indirectInstanceCount, firstInstance },
  };
}

export function validateResearchCourtyardInput(input) {
  const source = requireRecord(input, "input");
  const textureCount =
    source.textureCount === undefined
      ? undefined
      : requireUint(source.textureCount, "textureCount");
  const materialsSource = requireList(source.materials, "materials");
  if (materialsSource.length === 0) fail("materials must not be empty.");
  const materials = materialsSource.map((material, index) =>
    normalizeMaterial(material, index, textureCount),
  );
  const instancesSource = requireList(source.instances, "instances");
  const primitivesSource = requireList(source.primitives, "primitives");
  if (primitivesSource.length === 0) fail("primitives must not be empty.");
  const primitives = primitivesSource.map((primitive, index) =>
    normalizePrimitive(primitive, index, materials.length, instancesSource.length),
  );
  const meshIndices = [...new Set(primitives.map((primitive) => primitive.meshIndex))].sort(
    (left, right) => left - right,
  );
  for (let index = 0; index < meshIndices.length; index += 1)
    if (meshIndices[index] !== index)
      fail("meshIndex values must be contiguous and start at zero.");
  const meshCount = meshIndices.length;
  const instances = instancesSource.map((instance, index) =>
    normalizeInstance(instance, index, meshCount, materials.length),
  );
  const meshes = [];
  for (let meshIndex = 0; meshIndex < meshCount; meshIndex += 1) {
    const lods = primitives
      .filter((primitive) => primitive.meshIndex === meshIndex)
      .sort((left, right) => left.lod - right.lod);
    if (lods.length !== 3 || lods.some((primitive, lod) => primitive.lod !== lod))
      fail(`mesh ${meshIndex} must contain exactly LOD0, LOD1 and LOD2.`);
    const policies = new Set(lods.map((lod) => lod.lodPolicy));
    if (policies.size !== 1) fail(`mesh ${meshIndex} must keep one LOD policy.`);
    const lodPolicy = lods[0].lodPolicy;
    if (lodPolicy === "simplified") {
      if (
        lods[0].indices.length <= lods[1].indices.length ||
        lods[1].indices.length <= lods[2].indices.length
      )
        fail(`mesh ${meshIndex} must use strictly decreasing LOD index counts.`);
      if (
        lods[0].vertices.length < lods[1].vertices.length ||
        lods[1].vertices.length < lods[2].vertices.length
      )
        fail(`mesh ${meshIndex} must use non-increasing LOD vertex counts.`);
      if (lods[0].screenError >= lods[1].screenError || lods[1].screenError >= lods[2].screenError)
        fail(`mesh ${meshIndex} must use strictly increasing screen errors.`);
    } else if (
      lods[0].indices.length !== lods[1].indices.length ||
      lods[1].indices.length !== lods[2].indices.length ||
      lods[0].vertices.length !== lods[1].vertices.length ||
      lods[1].vertices.length !== lods[2].vertices.length ||
      lods.some((lod) => lod.screenError !== 0)
    )
      fail(`mesh ${meshIndex} preserved LODs must retain identical geometry and zero error.`);
    if (new Set(lods.map((lod) => lod.materialIndex)).size !== 1)
      fail(`mesh ${meshIndex} must keep one material across all LODs.`);
    meshes.push({ meshIndex, lodPolicy, lods });
  }
  return { textureCount, materials, instances, meshes };
}

function writeIndexedIndirect(view, offset, command) {
  view.setUint32(offset + 0, command.indexCount, true);
  view.setUint32(offset + 4, command.instanceCount, true);
  view.setUint32(offset + 8, command.firstIndex, true);
  view.setInt32(offset + 12, command.baseVertex, true);
  view.setUint32(offset + 16, command.firstInstance, true);
}

export function buildResearchCourtyardBinaryMetadata({ buffers, meshes }) {
  const vertices = byteView(buffers.vertices, "vertices");
  const indices = byteView(buffers.indices, "indices");
  const materials = byteView(buffers.materials, "materials");
  const instances = byteView(buffers.instances, "instances");
  const indirect = byteView(buffers.indirect, "indirect");
  assertStride(vertices, VERTEX_STRIDE, "vertices");
  assertStride(indices, INDEX_STRIDE, "indices");
  assertStride(materials, MATERIAL_STRIDE, "materials");
  assertStride(instances, INSTANCE_STRIDE, "instances");
  assertStride(indirect, INDEXED_INDIRECT_STRIDE, "indirect");
  return {
    version: 2,
    endian: "little",
    layout: {
      vertexStride: VERTEX_STRIDE,
      indexStride: INDEX_STRIDE,
      materialStride: MATERIAL_STRIDE,
      instanceStride: INSTANCE_STRIDE,
      indexedIndirectStride: INDEXED_INDIRECT_STRIDE,
    },
    counts: {
      vertices: vertices.byteLength / VERTEX_STRIDE,
      indices: indices.byteLength / INDEX_STRIDE,
      materials: materials.byteLength / MATERIAL_STRIDE,
      instances: instances.byteLength / INSTANCE_STRIDE,
      meshes: meshes.length,
      indexedIndirectCommands: indirect.byteLength / INDEXED_INDIRECT_STRIDE,
    },
    buffers: {
      vertices: { bytes: vertices.byteLength, sha256: sha256(vertices) },
      indices: { bytes: indices.byteLength, sha256: sha256(indices) },
      materials: { bytes: materials.byteLength, sha256: sha256(materials) },
      instances: { bytes: instances.byteLength, sha256: sha256(instances) },
      indirect: { bytes: indirect.byteLength, sha256: sha256(indirect) },
    },
    meshes: meshes.map((mesh) => ({
      meshIndex: mesh.meshIndex,
      lodPolicy: mesh.lodPolicy,
      lods: mesh.lods.map((lod) => ({ ...lod })),
    })),
  };
}

export function encodeResearchCourtyardBinary(input) {
  const normalized = validateResearchCourtyardInput(input);
  const primitiveCount = normalized.meshes.length * 3;
  const totalVertices = normalized.meshes.reduce(
    (sum, mesh) => sum + mesh.lods.reduce((lodSum, lod) => lodSum + lod.vertices.length, 0),
    0,
  );
  const totalIndices = normalized.meshes.reduce(
    (sum, mesh) => sum + mesh.lods.reduce((lodSum, lod) => lodSum + lod.indices.length, 0),
    0,
  );
  if (totalVertices > INT32_MAX) fail("vertex count exceeds baseVertex range.");
  const buffers = {
    vertices: new ArrayBuffer(checkedByteLength(totalVertices, VERTEX_STRIDE, "vertices")),
    indices: new ArrayBuffer(checkedByteLength(totalIndices, INDEX_STRIDE, "indices")),
    materials: new ArrayBuffer(
      checkedByteLength(normalized.materials.length, MATERIAL_STRIDE, "materials"),
    ),
    instances: new ArrayBuffer(
      checkedByteLength(normalized.instances.length, INSTANCE_STRIDE, "instances"),
    ),
    indirect: new ArrayBuffer(
      checkedByteLength(primitiveCount, INDEXED_INDIRECT_STRIDE, "indirect"),
    ),
  };
  const vertexView = new DataView(buffers.vertices);
  const indexView = new DataView(buffers.indices);
  const materialView = new DataView(buffers.materials);
  const instanceView = new DataView(buffers.instances);
  const indirectView = new DataView(buffers.indirect);
  normalized.materials.forEach((material, index) =>
    writeMaterial(materialView, index * MATERIAL_STRIDE, material),
  );
  normalized.instances.forEach((instance, index) =>
    writeInstance(instanceView, index * INSTANCE_STRIDE, instance),
  );
  let baseVertex = 0;
  let firstIndex = 0;
  let commandIndex = 0;
  const meshes = normalized.meshes.map((mesh) => ({
    meshIndex: mesh.meshIndex,
    lodPolicy: mesh.lodPolicy,
    lods: mesh.lods.map((primitive) => {
      const lodBaseVertex = baseVertex;
      const lodFirstIndex = firstIndex;
      primitive.vertices.forEach((vertex, vertexIndex) =>
        writeVertex(vertexView, (lodBaseVertex + vertexIndex) * VERTEX_STRIDE, vertex),
      );
      primitive.indices.forEach((value, indexIndex) =>
        indexView.setUint32((lodFirstIndex + indexIndex) * INDEX_STRIDE, value, true),
      );
      writeIndexedIndirect(indirectView, commandIndex * INDEXED_INDIRECT_STRIDE, {
        indexCount: primitive.indices.length,
        instanceCount: primitive.indirect.instanceCount,
        firstIndex: lodFirstIndex,
        baseVertex: requireInt32(lodBaseVertex, "baseVertex"),
        firstInstance: primitive.indirect.firstInstance,
      });
      const metadata = {
        lod: primitive.lod,
        materialIndex: primitive.materialIndex,
        firstIndex: lodFirstIndex,
        indexCount: primitive.indices.length,
        baseVertex: lodBaseVertex,
        vertexCount: primitive.vertices.length,
        screenError: primitive.screenError,
        indirectOffset: commandIndex * INDEXED_INDIRECT_STRIDE,
        instanceCount: primitive.indirect.instanceCount,
        firstInstance: primitive.indirect.firstInstance,
      };
      baseVertex += primitive.vertices.length;
      firstIndex += primitive.indices.length;
      commandIndex += 1;
      return metadata;
    }),
  }));
  const metadata = buildResearchCourtyardBinaryMetadata({ buffers, meshes });
  const encoded = { buffers, metadata };
  validateResearchCourtyardPackedBuffers(encoded);
  return encoded;
}

export function validateVertexBuffer(buffer) {
  const bytes = byteView(buffer, "vertices");
  assertStride(bytes, VERTEX_STRIDE, "vertices");
  const view = dataView(bytes, "vertices");
  for (let offset = 0; offset < bytes.byteLength; offset += VERTEX_STRIDE) {
    for (const componentOffset of [0, 4, 8])
      requireFinite(view.getFloat32(offset + componentOffset, true), "vertex position");
    zeroRange(view, offset + 28, 4, "vertex");
  }
  return { count: bytes.byteLength / VERTEX_STRIDE };
}

export function validateIndexBuffer(buffer, maximumIndex = UINT32_MAX) {
  const bytes = byteView(buffer, "indices");
  assertStride(bytes, INDEX_STRIDE, "indices");
  const view = dataView(bytes, "indices");
  for (let offset = 0; offset < bytes.byteLength; offset += INDEX_STRIDE)
    if (view.getUint32(offset, true) > maximumIndex)
      fail(`index at byte ${offset} exceeds maximum ${maximumIndex}.`);
  return { count: bytes.byteLength / INDEX_STRIDE };
}

export function validateMaterialBuffer(buffer) {
  const bytes = byteView(buffer, "materials");
  assertStride(bytes, MATERIAL_STRIDE, "materials");
  const view = dataView(bytes, "materials");
  for (let offset = 0; offset < bytes.byteLength; offset += MATERIAL_STRIDE) {
    for (const componentOffset of [0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40])
      requireFinite(view.getFloat32(offset + componentOffset, true), "material factor");
    if (view.getUint32(offset + 44, true) > 3) fail("material flags exceed the Pack v2 mask.");
    zeroRange(view, offset + 60, 4, "material");
  }
  return { count: bytes.byteLength / MATERIAL_STRIDE };
}

export function validateInstanceBuffer(buffer, meshCount, materialCount) {
  const bytes = byteView(buffer, "instances");
  assertStride(bytes, INSTANCE_STRIDE, "instances");
  const view = dataView(bytes, "instances");
  for (let offset = 0; offset < bytes.byteLength; offset += INSTANCE_STRIDE) {
    for (let componentOffset = 0; componentOffset < 96; componentOffset += 4)
      requireFinite(view.getFloat32(offset + componentOffset, true), "instance transform");
    const materialIndex = view.getUint32(offset + 96, true);
    const meshIndex = view.getUint32(offset + 100, true);
    if (materialIndex >= materialCount)
      fail(`instance material index ${materialIndex} is out of range.`);
    if (meshIndex >= meshCount) fail(`instance mesh index ${meshIndex} is out of range.`);
    for (let componentOffset = 108; componentOffset <= 120; componentOffset += 4)
      requireFinite(view.getFloat32(offset + componentOffset, true), "instance world sphere");
    if (view.getFloat32(offset + 120, true) <= 0)
      fail("instance world sphere radius must be greater than zero.");
    zeroRange(view, offset + 124, 4, "instance");
  }
  return { count: bytes.byteLength / INSTANCE_STRIDE };
}

export function validateIndexedIndirectBuffer(buffer) {
  const bytes = byteView(buffer, "indirect");
  assertStride(bytes, INDEXED_INDIRECT_STRIDE, "indirect");
  const view = dataView(bytes, "indirect");
  for (let offset = 0; offset < bytes.byteLength; offset += INDEXED_INDIRECT_STRIDE)
    zeroRange(view, offset + 20, 12, "indexed indirect command");
  return { count: bytes.byteLength / INDEXED_INDIRECT_STRIDE };
}

export function validateResearchCourtyardPackedBuffers(encoded) {
  const source = requireRecord(encoded, "encoded scene");
  const buffers = requireRecord(source.buffers, "encoded scene.buffers");
  const metadata = requireRecord(source.metadata, "encoded scene.metadata");
  const vertexResult = validateVertexBuffer(buffers.vertices);
  const indexResult = validateIndexBuffer(buffers.indices);
  const materialResult = validateMaterialBuffer(buffers.materials);
  const meshCount = requireList(metadata.meshes, "metadata.meshes").length;
  const instanceResult = validateInstanceBuffer(buffers.instances, meshCount, materialResult.count);
  const commandResult = validateIndexedIndirectBuffer(buffers.indirect);
  if (commandResult.count !== meshCount * 3)
    fail("indirect command count must equal meshCount x 3.");
  const indexView = dataView(buffers.indices, "indices");
  const indirectView = dataView(buffers.indirect, "indirect");
  let commandIndex = 0;
  for (const mesh of metadata.meshes) {
    const lods = requireList(mesh.lods, "metadata mesh lods");
    if (lods.length !== 3) fail("every metadata mesh must contain three LOD records.");
    for (const lod of lods) {
      const firstIndex = requireUint(lod.firstIndex, "metadata firstIndex");
      const indexCount = requireUint(lod.indexCount, "metadata indexCount");
      const vertexCount = requireUint(lod.vertexCount, "metadata vertexCount");
      const baseVertex = requireUint(lod.baseVertex, "metadata baseVertex", INT32_MAX);
      if (firstIndex + indexCount > indexResult.count)
        fail("metadata index range exceeds index buffer.");
      if (baseVertex + vertexCount > vertexResult.count)
        fail("metadata vertex range exceeds vertex buffer.");
      for (let index = 0; index < indexCount; index += 1)
        if (indexView.getUint32((firstIndex + index) * INDEX_STRIDE, true) >= vertexCount)
          fail("local index exceeds its LOD vertex range.");
      const commandOffset = commandIndex * INDEXED_INDIRECT_STRIDE;
      if (
        indirectView.getUint32(commandOffset + 0, true) !== indexCount ||
        indirectView.getUint32(commandOffset + 8, true) !== firstIndex ||
        indirectView.getInt32(commandOffset + 12, true) !== baseVertex
      )
        fail("indirect command does not match LOD metadata.");
      const firstInstance = indirectView.getUint32(commandOffset + 16, true);
      const instanceCount = indirectView.getUint32(commandOffset + 4, true);
      if (firstInstance !== 0) fail("indirect firstInstance must remain zero.");
      if (firstInstance + instanceCount > instanceResult.count)
        fail("indirect instance range exceeds instance buffer.");
      commandIndex += 1;
    }
  }
  return {
    vertices: vertexResult.count,
    indices: indexResult.count,
    materials: materialResult.count,
    instances: instanceResult.count,
    commands: commandResult.count,
  };
}
