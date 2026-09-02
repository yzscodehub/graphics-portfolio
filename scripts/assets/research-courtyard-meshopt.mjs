import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

const geometryBudget = 3.5 * 1024 * 1024;

export const researchCourtyardMeshoptFormat = "graphics-portfolio-research-courtyard-meshopt";
export const researchCourtyardMeshoptVersion = 1;
export const meshoptPackageVersion = "1.1.1";
export const meshoptCodecVersion = 1;

const contracts = Object.freeze({
  vertices: Object.freeze({ mode: "ATTRIBUTES", stride: 32 }),
  indices: Object.freeze({ mode: "TRIANGLES", stride: 4 }),
  materials: Object.freeze({ mode: "ATTRIBUTES", stride: 64 }),
  instances: Object.freeze({ mode: "ATTRIBUTES", stride: 128 }),
  indirect: Object.freeze({ mode: "ATTRIBUTES", stride: 32 }),
});

export class ResearchCourtyardMeshoptError extends Error {
  constructor(pathname, message) {
    super(`${pathname}: ${message}`);
    this.name = "ResearchCourtyardMeshoptError";
    this.path = pathname;
  }
}

function fail(pathname, message) {
  throw new ResearchCourtyardMeshoptError(pathname, message);
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function packageVersion() {
  const require = createRequire(import.meta.url);
  const entry = require.resolve("meshoptimizer");
  const packageFile = path.resolve(path.dirname(entry), "package.json");
  return JSON.parse(readFileSync(packageFile, "utf8")).version;
}

function bytes(value, pathname) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value))
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  fail(pathname, "must be an ArrayBuffer or typed array");
}

async function ready() {
  if (packageVersion() !== meshoptPackageVersion)
    fail("meshoptimizer", `expected ${meshoptPackageVersion}`);
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  if (!MeshoptEncoder.supported || !MeshoptDecoder.supported)
    fail("meshoptimizer", "WebAssembly encoder/decoder is unavailable");
}

function encodeBuffer(source, contract) {
  const count = source.byteLength / contract.stride;
  if (!Number.isSafeInteger(count) || count <= 0)
    fail("buffer", `must be non-empty and aligned to stride ${contract.stride}`);
  return contract.mode === "TRIANGLES"
    ? MeshoptEncoder.encodeGltfBuffer(
        source,
        count,
        contract.stride,
        contract.mode,
        meshoptCodecVersion,
      )
    : MeshoptEncoder.encodeVertexBufferLevel(
        source,
        count,
        contract.stride,
        3,
        meshoptCodecVersion,
      );
}

export function decodeResearchCourtyardMeshoptBuffer(encoded, record) {
  const source = bytes(encoded, record.name);
  const output = new Uint8Array(record.decodedBytes);
  if (record.mode === "TRIANGLES")
    MeshoptDecoder.decodeIndexBuffer(output, record.count, record.stride, source);
  else MeshoptDecoder.decodeVertexBuffer(output, record.count, record.stride, source);
  return output;
}

function cyclicTriangleParity(source, decoded) {
  if (source.byteLength !== decoded.byteLength || source.byteLength % 12 !== 0) return false;
  const left = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const right = new DataView(decoded.buffer, decoded.byteOffset, decoded.byteLength);
  for (let offset = 0; offset < source.byteLength; offset += 12) {
    const expected = [0, 4, 8].map((delta) => left.getUint32(offset + delta, true));
    const actual = [0, 4, 8].map((delta) => right.getUint32(offset + delta, true));
    const matches = [0, 1, 2].some((rotation) =>
      actual.every((value, index) => value === expected[(index + rotation) % 3]),
    );
    if (!matches) return false;
  }
  return true;
}

export async function compressResearchCourtyardBuffers(buffers) {
  await ready();
  const names = Object.keys(contracts);
  if (
    !buffers ||
    Object.keys(buffers).length !== names.length ||
    names.some((name) => !(name in buffers))
  )
    fail("buffers", `must contain exactly ${names.join(", ")}`);
  const encodedBuffers = {};
  const records = {};
  for (const name of names) {
    const source = bytes(buffers[name], name);
    const contract = contracts[name];
    const encoded = encodeBuffer(source, contract);
    const record = {
      name,
      codec: "meshopt",
      codecVersion: meshoptCodecVersion,
      encoderLevel: contract.mode === "ATTRIBUTES" ? 3 : null,
      mode: contract.mode,
      count: source.byteLength / contract.stride,
      stride: contract.stride,
      decodedBytes: source.byteLength,
      sourceSha256: digest(source),
      decodedSha256: null,
      encodedBytes: encoded.byteLength,
      encodedSha256: digest(encoded),
    };
    const decoded = decodeResearchCourtyardMeshoptBuffer(encoded, record);
    record.decodedSha256 = digest(decoded);
    record.parity = contract.mode === "TRIANGLES" ? "cyclic-triangle" : "byte-exact";
    if (
      (record.parity === "byte-exact" && record.decodedSha256 !== record.sourceSha256) ||
      (record.parity === "cyclic-triangle" && !cyclicTriangleParity(source, decoded))
    )
      fail(name, `failed ${record.parity} decoder parity`);
    encodedBuffers[name] = encoded;
    records[name] = record;
  }
  const encodedBytes = Object.values(records).reduce((sum, record) => sum + record.encodedBytes, 0);
  if (encodedBytes > geometryBudget)
    fail("budget", `encoded buffers use ${encodedBytes} bytes, exceeding ${geometryBudget}`);
  return {
    buffers: encodedBuffers,
    manifest: {
      format: researchCourtyardMeshoptFormat,
      version: researchCourtyardMeshoptVersion,
      packageVersion: meshoptPackageVersion,
      codecVersion: meshoptCodecVersion,
      encodedBytes,
      budgetBytes: geometryBudget,
      records,
    },
  };
}
