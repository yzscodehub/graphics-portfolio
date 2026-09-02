import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
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
import { fileURLToPath } from "node:url";

import { loadRenderingSourceLock } from "./manifest.mjs";
import { loadResearchCourtyardHdriCandidate } from "./research-courtyard-hdri.mjs";
import { loadResearchCourtyardRuntimeTextures } from "./research-courtyard-ktx2.mjs";
import {
  loadResearchCourtyardRecipe,
  researchCourtyardRecipeSha256,
} from "./research-courtyard-recipe.mjs";
import {
  assembleResearchCourtyardScene,
  loadResearchCourtyardLodCandidate,
} from "./research-courtyard-scene.mjs";
import { toolchainLockSha256 } from "./toolchain.mjs";

const thisFile = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(thisFile), "../..");
const safeId = /^[a-z0-9][a-z0-9._-]*$/i;

export const researchCourtyardCompilerFormat = "graphics-portfolio-research-courtyard-compiler";
export const researchCourtyardCompilerVersion = 1;

export class ResearchCourtyardCompilerError extends Error {
  constructor(pathname, message) {
    super(`${pathname}: ${message}`);
    this.name = "ResearchCourtyardCompilerError";
    this.path = pathname;
  }
}

function fail(pathname, message) {
  throw new ResearchCourtyardCompilerError(pathname, message);
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fileDigest(file) {
  return digest(readFileSync(file));
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

function canonicalJson(value) {
  return `${JSON.stringify(canonical(value), null, 2)}\n`;
}

function within(parent, candidate) {
  const relation = path.relative(path.resolve(parent), path.resolve(candidate));
  return relation === "" || (!relation.startsWith("..") && !path.isAbsolute(relation));
}

function safeRelative(root, relative, pathname) {
  if (
    typeof relative !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(relative) ||
    relative.includes("\\") ||
    relative.split("/").some((part) => !part || part === "." || part === "..")
  )
    fail(pathname, "contains an unsafe path");
  const file = path.resolve(root, relative);
  if (!within(root, file)) fail(pathname, "escaped its root");
  return file;
}

function outputPath(staging, relative) {
  const file = safeRelative(staging, relative, "output");
  if (existsSync(file)) fail("output", `${relative} already exists`);
  mkdirSync(path.dirname(file), { recursive: true });
  return file;
}

function fileReceipt(staging, file) {
  if (
    !existsSync(file) ||
    !lstatSync(file).isFile() ||
    lstatSync(file).isSymbolicLink() ||
    statSync(file).size === 0
  )
    fail("output", `${file} is missing or unsafe`);
  return {
    uri: path.relative(staging, file).replaceAll("\\", "/"),
    bytes: statSync(file).size,
    sha256: fileDigest(file),
  };
}

function copyReceipt(sourceRoot, receipt, staging) {
  const source = safeRelative(sourceRoot, receipt.path, "input artifact");
  if (
    !existsSync(source) ||
    !lstatSync(source).isFile() ||
    lstatSync(source).isSymbolicLink() ||
    statSync(source).size !== receipt.bytes ||
    fileDigest(source) !== receipt.sha256
  )
    fail("input artifact", `${receipt.path} changed after validation`);
  const output = outputPath(staging, receipt.path);
  copyFileSync(source, output);
  return fileReceipt(staging, output);
}

function exactIdentity(label, actual, expected) {
  if (actual !== expected) fail(label, `expected ${expected}, received ${actual}`);
}

export async function compileResearchCourtyardV2Candidate({
  root = projectRoot,
  lodCandidateDir,
  runtimeTextureDir,
  hdriCandidateDir,
  candidateId = `candidate-${randomUUID()}`,
  outputRoot = path.join(root, ".cache/rendering-builds/research-courtyard-v2"),
}) {
  root = path.resolve(root);
  if (!safeId.test(candidateId)) fail("candidateId", "must be a safe path segment");
  const cacheRoot = path.resolve(root, ".cache");
  outputRoot = path.resolve(outputRoot);
  if (!within(cacheRoot, outputRoot))
    fail("outputRoot", "must remain inside the ignored .cache directory");
  mkdirSync(outputRoot, { recursive: true });
  if (!lstatSync(outputRoot).isDirectory() || lstatSync(outputRoot).isSymbolicLink())
    fail("outputRoot", "must be a real directory");
  const output = path.join(outputRoot, candidateId);
  const staging = path.join(outputRoot, `.staging-${candidateId}-${randomUUID()}`);
  if (existsSync(output)) fail("candidateId", "candidate already exists");

  const sourceLockPath = path.join(root, "public/assets/rendering/sources.lock.json");
  const sourceLock = loadRenderingSourceLock(root);
  const sourceLockSha256 = fileDigest(sourceLockPath);
  const recipe = loadResearchCourtyardRecipe(root, { verifyFiles: true });
  const recipeSha256 = researchCourtyardRecipeSha256(root);
  const currentToolchainSha256 = toolchainLockSha256(root);
  const lod = loadResearchCourtyardLodCandidate(lodCandidateDir, {
    sourceSetSha256: sourceLock.sourceSetSha256,
    recipeSha256,
  });
  const textures = loadResearchCourtyardRuntimeTextures(runtimeTextureDir);
  const hdri = loadResearchCourtyardHdriCandidate(hdriCandidateDir);
  for (const [name, manifest] of [
    ["lod", lod.manifest],
    ["textures", textures.manifest],
    ["hdri", hdri.manifest],
  ]) {
    exactIdentity(`${name}.sourceSetSha256`, manifest.sourceSetSha256, sourceLock.sourceSetSha256);
    exactIdentity(`${name}.sourceLockSha256`, manifest.sourceLockSha256, sourceLockSha256);
    exactIdentity(`${name}.recipeSha256`, manifest.recipeSha256, recipeSha256);
  }
  exactIdentity(
    "lod.toolchainLockSha256",
    lod.manifest.toolchainLockSha256,
    currentToolchainSha256,
  );
  exactIdentity(
    "textures.toolchainLockSha256",
    textures.manifest.toolchainLockSha256,
    currentToolchainSha256,
  );
  const scene = await assembleResearchCourtyardScene({
    recipe,
    geometriesBySource: lod.geometriesBySource,
    textureCatalog: textures.catalog,
  });

  let committed = false;
  try {
    mkdirSync(staging, { recursive: false });
    const files = [];
    const bufferReceipts = {};
    for (const name of ["vertices", "indices", "materials", "instances", "indirect"]) {
      const descriptor = scene.pack.transport[name];
      const file = outputPath(staging, descriptor.uri);
      writeFileSync(file, scene.encodedBuffers[name]);
      const receipt = fileReceipt(staging, file);
      if (
        receipt.bytes !== descriptor.encoding.encodedBytes ||
        receipt.sha256 !== descriptor.encoding.encodedSha256
      )
        fail(name, "encoded buffer differs from Pack v2 metadata");
      bufferReceipts[name] = receipt;
      files.push(receipt);
    }

    const textureReceipts = {};
    for (const texture of textures.manifest.textures) {
      const ktx2 = copyReceipt(textures.directory, texture.ktx2, staging);
      const webp = copyReceipt(textures.directory, texture.webp, staging);
      textureReceipts[texture.id] = {
        colorSpace: texture.colorSpace,
        ktx2,
        webp,
      };
      files.push(ktx2, webp);
    }

    const shFile = outputPath(staging, "courtyard/diffuse-sh9.json");
    writeFileSync(
      shFile,
      canonicalJson({
        format: "graphics-portfolio-diffuse-irradiance-sh9",
        version: 1,
        source: hdri.manifest.source,
        diffuseSh: hdri.manifest.diffuseSh,
        specularIbl: false,
        runtimeHdr: false,
      }),
    );
    const shReceipt = fileReceipt(staging, shFile);
    files.push(shReceipt);

    let previewReceipt = null;
    if (hdri.manifest.preview) {
      const source = safeRelative(hdri.directory, hdri.manifest.preview.path, "hdri preview");
      const target = outputPath(staging, "evidence/courtyard-tonemapped-1k.webp");
      copyFileSync(source, target);
      previewReceipt = fileReceipt(staging, target);
      if (
        previewReceipt.bytes !== hdri.manifest.preview.bytes ||
        previewReceipt.sha256 !== hdri.manifest.preview.sha256
      )
        fail("hdri preview", "changed after candidate validation");
      files.push(previewReceipt);
    }

    const packFile = outputPath(staging, "courtyard/research-courtyard.pack.json");
    writeFileSync(packFile, canonicalJson(scene.pack));
    const packReceipt = fileReceipt(staging, packFile);
    files.push(packReceipt);

    const runtimeManifest = {
      version: 2,
      sourceSetSha256: sourceLock.sourceSetSha256,
      recipeSha256,
      toolchainLockSha256: currentToolchainSha256,
      pack: packReceipt,
      buffers: bufferReceipts,
      textures: textureReceipts,
      environment: {
        diffuseSh: shReceipt,
        reviewPreview: previewReceipt,
        specularIbl: false,
        runtimeHdr: false,
      },
    };
    const runtimeFile = outputPath(staging, "runtime.manifest.json");
    writeFileSync(runtimeFile, canonicalJson(runtimeManifest));
    const runtimeReceipt = fileReceipt(staging, runtimeFile);
    files.push(runtimeReceipt);

    const budgets = {
      publicRenderingBytes: files.reduce((sum, file) => sum + file.bytes, 0),
      courtyardGeometryBytes: scene.meshopt.encodedBytes,
      ktx2Bytes: textures.manifest.totals.ktx2Bytes,
      webpFallbackBytes: textures.manifest.totals.webpBytes,
      demoInitialKtx2Bytes:
        scene.meshopt.encodedBytes +
        textures.manifest.totals.ktx2Bytes +
        packReceipt.bytes +
        shReceipt.bytes,
      demoInitialWebpBytes:
        scene.meshopt.encodedBytes +
        textures.manifest.totals.webpBytes +
        packReceipt.bytes +
        shReceipt.bytes,
    };
    const limits = recipe.budgets;
    if (
      budgets.publicRenderingBytes > limits.publicRenderingBytes ||
      budgets.courtyardGeometryBytes > limits.courtyardGeometryBytes ||
      budgets.ktx2Bytes > limits.ktx2Bytes ||
      budgets.webpFallbackBytes > limits.webpFallbackBytes ||
      budgets.demoInitialKtx2Bytes > limits.demoInitialBytes ||
      budgets.demoInitialWebpBytes > limits.demoInitialBytes
    )
      fail("budget", `candidate exceeds a fixed budget: ${JSON.stringify(budgets)}`);

    files.sort((left, right) => left.uri.localeCompare(right.uri));
    const candidateManifest = {
      format: researchCourtyardCompilerFormat,
      version: researchCourtyardCompilerVersion,
      status: "candidate",
      publishable: false,
      sourceSetSha256: sourceLock.sourceSetSha256,
      sourceLockSha256,
      recipeSha256,
      toolchainLockSha256: currentToolchainSha256,
      inputs: {
        lodManifestSha256: fileDigest(lod.manifestPath),
        runtimeTexturesManifestSha256: textures.manifestSha256,
        hdriManifestSha256: hdri.manifestSha256,
      },
      counts: scene.counts,
      budgets,
      runtimeManifest: runtimeReceipt,
      candidateArtifactsSha256: digest(canonicalJson(files)),
      files,
      currentLimit:
        "This is an ignored, fully assembled candidate. It is not reviewed runtime evidence and cannot be promoted to public/ until the visual review and two-clean-build receipt pass.",
    };
    writeFileSync(outputPath(staging, "candidate.manifest.json"), canonicalJson(candidateManifest));
    if (existsSync(output)) fail("candidateId", "candidate appeared during staging");
    renameSync(staging, output);
    committed = true;
    return {
      outputDir: output,
      manifestPath: path.join(output, "candidate.manifest.json"),
      manifest: candidateManifest,
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
          "Research Courtyard compilation failed and staging cleanup also failed.",
          { cause: cleanupError },
        );
      }
    throw error;
  }
}

function parseArguments(argumentsList) {
  const values = new Map();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const flag = argumentsList[index];
    const value = argumentsList[index + 1];
    if (
      !["--lod", "--textures", "--hdri", "--candidate-id"].includes(flag) ||
      typeof value !== "string" ||
      values.has(flag)
    )
      fail(
        "arguments",
        "usage: compile-research-courtyard-v2.mjs --lod DIR --textures DIR --hdri DIR [--candidate-id ID]",
      );
    values.set(flag, value);
  }
  for (const flag of ["--lod", "--textures", "--hdri"])
    if (!values.has(flag)) fail("arguments", `${flag} is required`);
  return {
    lodCandidateDir: path.resolve(values.get("--lod")),
    runtimeTextureDir: path.resolve(values.get("--textures")),
    hdriCandidateDir: path.resolve(values.get("--hdri")),
    candidateId: values.get("--candidate-id") ?? "candidate",
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  try {
    const result = await compileResearchCourtyardV2Candidate(parseArguments(process.argv.slice(2)));
    console.log(
      canonicalJson({
        outputDir: result.outputDir,
        manifestPath: result.manifestPath,
        counts: result.manifest.counts,
        budgets: result.manifest.budgets,
        candidateArtifactsSha256: result.manifest.candidateArtifactsSha256,
      }),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
