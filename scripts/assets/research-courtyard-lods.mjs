import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { loadRenderingSourceLock } from "./manifest.mjs";
import { normalizeReviewedMeshSource } from "./research-courtyard-geometry.mjs";
import {
  loadResearchCourtyardRecipe,
  researchCourtyardRecipeSha256,
} from "./research-courtyard-recipe.mjs";
import { resolveInstalledToolCommands } from "./toolchain.mjs";

const thisFile = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(thisFile), "../..");
const safeId = /^[a-z0-9][a-z0-9._-]*$/i;

export const researchCourtyardLodFormat = "graphics-portfolio-research-courtyard-lods";
export const researchCourtyardLodVersion = 1;

export class ResearchCourtyardLodError extends Error {
  constructor(pathname, message) {
    super(`${pathname}: ${message}`);
    this.name = "ResearchCourtyardLodError";
    this.path = pathname;
  }
}

function fail(pathname, message) {
  throw new ResearchCourtyardLodError(pathname, message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sorted(child)]),
  );
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function canonicalJson(value) {
  return `${JSON.stringify(sorted(value), null, 2)}\n`;
}

function fileReceipt(absolute, relativeRoot) {
  if (
    !existsSync(absolute) ||
    !lstatSync(absolute).isFile() ||
    lstatSync(absolute).isSymbolicLink()
  )
    fail("candidate", `missing or unsafe file ${absolute}`);
  const bytes = readFileSync(absolute);
  return {
    path: path.relative(relativeRoot, absolute).replaceAll("\\", "/"),
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
  };
}

function isWithin(parent, child) {
  const relation = path.relative(path.resolve(parent), path.resolve(child));
  return relation === "" || (!relation.startsWith(`..${path.sep}`) && relation !== "..");
}

function requireCachePath(root, value, pathname) {
  const absolute = path.resolve(value);
  const cache = path.resolve(root, ".cache");
  if (!isWithin(cache, absolute)) fail(pathname, "must remain inside the ignored .cache directory");
  for (const forbidden of [path.resolve(root, "public"), path.resolve(root, "dist")])
    if (isWithin(forbidden, absolute)) fail(pathname, "must not target public or dist");
  return absolute;
}

function commandResult(command, argumentsList, cwd) {
  const result = spawnSync(command, argumentsList, {
    cwd,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${path.basename(command)} exited ${String(result.status)}: ${(
        result.stderr ||
        result.stdout ||
        "no output"
      ).trim()}`,
    );
}

export function gltfpackArguments(tool, input, output, ratio, maxError) {
  if (
    !tool ||
    tool.id !== "gltfpack" ||
    tool.version !== "1.1" ||
    typeof tool.commandPath !== "string" ||
    !Array.isArray(tool.commandArgs)
  )
    fail("toolchain.gltfpack", "requires the verified gltfpack 1.1 command descriptor");
  if (!(ratio > 0 && ratio <= 1) || !(maxError >= 0))
    fail("lod", "requires a ratio in (0,1] and non-negative max error");
  return [
    ...tool.commandArgs,
    "-i",
    input,
    "-o",
    output,
    "-kn",
    "-km",
    "-noq",
    "-si",
    String(ratio),
    "-se",
    String(maxError),
  ];
}

function meshSourceForLevel(meshSource, level) {
  if (level !== 2) return clone(meshSource);
  const droppedParts = new Set(meshSource.lod.lod2DropPartIds ?? []);
  const droppedNodes = new Set(meshSource.lod.lod2DropNodeNames ?? []);
  const result = clone(meshSource);
  result.parts = result.parts
    .filter((part) => !droppedParts.has(part.partId))
    .map((part) => ({
      ...part,
      nodeNames: part.nodeNames.filter((nodeName) => !droppedNodes.has(nodeName)),
    }))
    .filter((part) => part.nodeNames.length > 0);
  if (result.parts.length === 0)
    fail(meshSource.sourceId, "LOD2 exclusions removed every selected part");
  return result;
}

function filterMaterialDrops(geometry, meshSource, level) {
  if (level !== 2 || !meshSource.lod.lod2DropMaterialNames?.length) return geometry;
  const dropped = new Set(meshSource.lod.lod2DropMaterialNames);
  const result = clone(geometry);
  for (const part of result.parts)
    part.primitives = part.primitives.filter((primitive) => !dropped.has(primitive.material.name));
  result.parts = result.parts.filter((part) => part.primitives.length > 0);
  if (result.parts.length === 0)
    fail(meshSource.sourceId, "LOD2 material exclusions removed every primitive");
  return result;
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

function primitiveHash(primitive) {
  return sha256(
    canonicalJson({
      positions: primitive.positions,
      normals: primitive.normals,
      tangents: primitive.tangents,
      uvs: primitive.uvs,
      indices: primitive.indices,
      material: primitive.material,
    }),
  );
}

function primitiveRecords(geometry) {
  return geometry.parts
    .flatMap((part) => part.primitives)
    .map((primitive) => ({
      identity: primitiveIdentity(primitive),
      partId: primitive.partId,
      nodeName: primitive.nodeName,
      primitiveIndex: primitive.primitiveIndex,
      materialName: primitive.material.name,
      vertices: primitive.positions.length / 3,
      indices: primitive.indices.length,
      triangles: primitive.indices.length / 3,
      geometrySha256: primitiveHash(primitive),
    }))
    .sort((left, right) => left.identity.localeCompare(right.identity));
}

function expectedDroppedIdentities(base, meshSource) {
  const partIds = new Set(meshSource.lod.lod2DropPartIds ?? []);
  const nodes = new Set(meshSource.lod.lod2DropNodeNames ?? []);
  const materials = new Set(meshSource.lod.lod2DropMaterialNames ?? []);
  return new Set(
    base
      .filter(
        (primitive) =>
          partIds.has(primitive.partId) ||
          nodes.has(primitive.nodeName) ||
          materials.has(primitive.materialName),
      )
      .map((primitive) => primitive.identity),
  );
}

function assertDropDirectivesMatch(base, meshSource) {
  const directives = [
    ["part", meshSource.lod.lod2DropPartIds ?? [], "partId"],
    ["node", meshSource.lod.lod2DropNodeNames ?? [], "nodeName"],
    ["material", meshSource.lod.lod2DropMaterialNames ?? [], "materialName"],
  ];
  for (const [kind, values, field] of directives)
    for (const value of values)
      if (!base.some((record) => record[field] === value))
        fail(meshSource.sourceId, `LOD2 ${kind} exclusion ${value} matched no primitive`);
}

function preservedMaterialNames(meshSource) {
  if (meshSource.lod.preserveWireCards !== true) return new Set();
  return new Set(
    meshSource.materialOverrides
      .filter((override) => override.alphaSource?.kind === "max-rgb")
      .map((override) => override.materialName),
  );
}

export function preserveRecipePrimitives(geometry, baseGeometry, meshSource) {
  const materials = preservedMaterialNames(meshSource);
  if (materials.size === 0) return geometry;
  const result = clone(geometry);
  const resultParts = new Map(result.parts.map((part) => [part.partId, part]));
  for (const basePart of baseGeometry.parts) {
    const part = resultParts.get(basePart.partId);
    if (!part) continue;
    const replacementByIdentity = new Map(
      basePart.primitives
        .filter((primitive) => materials.has(primitive.material.name))
        .map((primitive) => [primitiveIdentity(primitive), primitive]),
    );
    const retained = part.primitives.filter(
      (primitive) => !replacementByIdentity.has(primitiveIdentity(primitive)),
    );
    part.primitives = [...retained, ...[...replacementByIdentity.values()].map(clone)].sort(
      (left, right) => primitiveIdentity(left).localeCompare(primitiveIdentity(right)),
    );
  }
  return result;
}

function translateBounds(bounds, delta) {
  return {
    min: bounds.min.map((value, index) => value + delta[index]),
    max: bounds.max.map((value, index) => value + delta[index]),
    center: bounds.center.map((value, index) => value + delta[index]),
    size: [...bounds.size],
  };
}

export function alignLodToBaseNormalization(geometry, baseGeometry) {
  const result = clone(geometry);
  const baseParts = new Map(baseGeometry.parts.map((part) => [part.partId, part]));
  for (const part of result.parts) {
    const base = baseParts.get(part.partId);
    if (!base) fail(part.partId, "has no matching LOD0 normalization");
    const current = part.normalization.translation;
    const target = base.normalization.translation;
    if (
      !Array.isArray(current) ||
      !Array.isArray(target) ||
      current.length !== 3 ||
      target.length !== 3
    )
      fail(part.partId, "requires three-component normalization translations");
    const delta = target.map((value, index) => value - current[index]);
    for (const primitive of part.primitives)
      for (let index = 0; index < primitive.positions.length; index += 3)
        for (let axis = 0; axis < 3; axis += 1) primitive.positions[index + axis] += delta[axis];
    part.bounds = translateBounds(part.bounds, delta);
    part.normalization = {
      mode: "ground-center-from-lod0",
      translation: [...target],
      sourceBounds: part.normalization.sourceBounds,
    };
  }
  return result;
}

function identitySet(records) {
  return new Set(records.map((record) => record.identity));
}

function assertIdentitySet(actual, expected, pathname) {
  if (actual.size !== expected.size || [...expected].some((identity) => !actual.has(identity)))
    fail(pathname, "primitive identity changed across LODs");
}

function classifiedRecords(baseRecords, candidateRecords, pathname) {
  const baseByIdentity = new Map(baseRecords.map((record) => [record.identity, record]));
  return candidateRecords.map((record) => {
    const base = baseByIdentity.get(record.identity);
    if (!base) fail(pathname, `has unexpected primitive ${record.identity}`);
    if (record.triangles > base.triangles)
      fail(
        pathname,
        `increased triangle count for ${record.identity}: ${base.triangles} -> ${record.triangles}`,
      );
    if (record.triangles === base.triangles && record.geometrySha256 !== base.geometrySha256)
      fail(pathname, `changed ${record.identity} without reducing its triangle count`);
    return {
      ...record,
      classification: record.triangles < base.triangles ? "simplified" : "preserved",
    };
  });
}

export function reconcileResearchCourtyardLods(meshSource, geometries) {
  if (!Array.isArray(geometries) || geometries.length !== 3)
    fail(meshSource?.sourceId ?? "mesh", "requires exactly LOD0, LOD1, and LOD2");
  const records = geometries.map(primitiveRecords);
  const baseSet = identitySet(records[0]);
  assertIdentitySet(identitySet(records[1]), baseSet, `${meshSource.sourceId}.lod1`);

  const dropped = expectedDroppedIdentities(records[0], meshSource);
  assertDropDirectivesMatch(records[0], meshSource);
  const expectedLod2 = new Set([...baseSet].filter((identity) => !dropped.has(identity)));
  assertIdentitySet(identitySet(records[2]), expectedLod2, `${meshSource.sourceId}.lod2`);

  const summaries = records.map((entries, level) => ({
    level,
    targetRatio: meshSource.lod.ratios[level],
    achievedRatio:
      records[0].reduce((sum, record) => sum + record.triangles, 0) === 0
        ? 0
        : entries.reduce((sum, record) => sum + record.triangles, 0) /
          records[0].reduce((sum, record) => sum + record.triangles, 0),
    maxError: meshSource.lod.maxErrors[level],
    triangles: entries.reduce((sum, record) => sum + record.triangles, 0),
    vertices: entries.reduce((sum, record) => sum + record.vertices, 0),
    primitives:
      level === 0
        ? entries.map((record) => ({ ...record, classification: "base" }))
        : classifiedRecords(records[0], entries, `${meshSource.sourceId}.lod${level}`),
    exclusions:
      level === 2
        ? records[0]
            .filter((record) => dropped.has(record.identity))
            .map((record) => ({ identity: record.identity, reason: "recipe-lod2-exclusion" }))
        : [],
  }));
  if (
    !(summaries[0].triangles > summaries[1].triangles) ||
    !(summaries[1].triangles > summaries[2].triangles)
  )
    fail(
      meshSource.sourceId,
      `did not produce strict total triangle reduction (${summaries
        .map((entry) => entry.triangles)
        .join(" -> ")})`,
    );
  return summaries;
}

function sourceLockSha256(root) {
  return sha256(readFileSync(path.join(root, "public/assets/rendering/sources.lock.json")));
}

function artifactDigest(files) {
  return sha256(
    canonicalJson(
      [...files]
        .sort((left, right) => left.path.localeCompare(right.path))
        .map(({ path: pathname, bytes, sha256: digest }) => ({
          path: pathname,
          bytes,
          sha256: digest,
        })),
    ),
  );
}

export async function buildResearchCourtyardLodCandidate({
  root = projectRoot,
  candidateId = `candidate-${randomUUID()}`,
  outputRoot = path.join(root, ".cache/rendering-builds/research-courtyard-lods"),
  run = commandResult,
  normalize = normalizeReviewedMeshSource,
} = {}) {
  root = path.resolve(root);
  if (!safeId.test(candidateId)) fail("candidateId", "must be a safe path segment");
  if (typeof run !== "function" || typeof normalize !== "function")
    fail("pipeline", "requires executable and normalizer functions");
  outputRoot = requireCachePath(root, outputRoot, "outputRoot");
  mkdirSync(outputRoot, { recursive: true });
  if (!lstatSync(outputRoot).isDirectory() || lstatSync(outputRoot).isSymbolicLink())
    fail("outputRoot", "must be a real directory");
  const finalRoot = path.join(outputRoot, candidateId);
  const staging = path.join(outputRoot, `.staging-${candidateId}-${randomUUID()}`);
  if (existsSync(finalRoot)) fail("candidateId", "candidate already exists");

  const sourceLock = loadRenderingSourceLock(root);
  const recipe = loadResearchCourtyardRecipe(root, { verifyFiles: true });
  const toolchain = resolveInstalledToolCommands(root);
  const tool = toolchain.commands.gltfpack;
  gltfpackArguments(tool, "input", "output", 1, 0);

  let committed = false;
  try {
    mkdirSync(staging, { recursive: false });
    const files = [];
    const sources = [];
    for (const meshSource of [...recipe.meshSources].sort((left, right) =>
      left.sourceId.localeCompare(right.sourceId),
    )) {
      const sourceDirectory = path.join(staging, "lods", meshSource.sourceId);
      mkdirSync(sourceDirectory, { recursive: true });
      const input = path.resolve(root, meshSource.gltf.path);
      const geometries = [];
      for (let level = 0; level < 3; level += 1) {
        const output = path.join(sourceDirectory, `lod${level}.glb`);
        const argumentsList = gltfpackArguments(
          tool,
          input,
          output,
          meshSource.lod.ratios[level],
          meshSource.lod.maxErrors[level],
        );
        await run(tool.commandPath, argumentsList, root, {
          sourceId: meshSource.sourceId,
          level,
        });
        if (
          !existsSync(output) ||
          !lstatSync(output).isFile() ||
          lstatSync(output).isSymbolicLink() ||
          statSync(output).size === 0
        )
          fail(`${meshSource.sourceId}.lod${level}`, "gltfpack produced no safe output");
        let geometry = await normalize(meshSourceForLevel(meshSource, level), output);
        geometry = filterMaterialDrops(geometry, meshSource, level);
        if (level > 0) geometry = alignLodToBaseNormalization(geometry, geometries[0]);
        if (level > 0) geometry = preserveRecipePrimitives(geometry, geometries[0], meshSource);
        geometries.push(geometry);
        files.push(fileReceipt(output, staging));
        const geometryDirectory = path.join(staging, "geometry", meshSource.sourceId);
        mkdirSync(geometryDirectory, { recursive: true });
        const geometryOutput = path.join(geometryDirectory, `lod${level}.json.gz`);
        writeFileSync(geometryOutput, gzipSync(Buffer.from(canonicalJson(geometry)), { level: 9 }));
        files.push(fileReceipt(geometryOutput, staging));
      }
      sources.push({
        sourceId: meshSource.sourceId,
        lods: reconcileResearchCourtyardLods(meshSource, geometries),
      });
    }
    files.sort((left, right) => left.path.localeCompare(right.path));
    const manifest = {
      format: researchCourtyardLodFormat,
      version: researchCourtyardLodVersion,
      status: "candidate",
      publishable: false,
      sourceSetSha256: sourceLock.sourceSetSha256,
      sourceLockSha256: sourceLockSha256(root),
      recipeSha256: researchCourtyardRecipeSha256(root),
      toolchainLockSha256: toolchain.lockSha256,
      candidateArtifactsSha256: artifactDigest(files),
      tool: {
        id: tool.id,
        version: tool.version,
        executableSha256: tool.executableSha256,
      },
      files,
      sources,
      currentLimit:
        "Candidate GLBs retain embedded source textures for audit only. Deterministic normalized geometry is stored as gzip JSON for Pack v2 assembly; runtime publication must use custom buffers and separately budgeted KTX2/WebP textures.",
    };
    writeFileSync(path.join(staging, "lod-candidate.manifest.json"), canonicalJson(manifest));
    if (existsSync(finalRoot)) fail("candidateId", "candidate appeared while staging");
    renameSync(staging, finalRoot);
    committed = true;
    return {
      outputRoot: finalRoot,
      manifestPath: path.join(finalRoot, "lod-candidate.manifest.json"),
      manifest,
    };
  } catch (error) {
    if (!committed && existsSync(staging))
      try {
        rmSync(staging, {
          recursive: true,
          force: true,
          maxRetries: 20,
          retryDelay: 100,
        });
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "LOD candidate build failed and staging cleanup also failed.",
          { cause: cleanupError },
        );
      }
    throw error;
  }
}

function parseArguments(argumentsList) {
  if (argumentsList.length === 0) return {};
  if (
    argumentsList.length !== 2 ||
    argumentsList[0] !== "--candidate-id" ||
    !safeId.test(argumentsList[1])
  )
    fail("arguments", "usage: research-courtyard-lods.mjs [--candidate-id ID]");
  return { candidateId: argumentsList[1] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  try {
    const result = await buildResearchCourtyardLodCandidate(parseArguments(process.argv.slice(2)));
    console.log(
      canonicalJson({
        outputRoot: result.outputRoot,
        manifestPath: result.manifestPath,
        candidateArtifactsSha256: result.manifest.candidateArtifactsSha256,
      }),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
