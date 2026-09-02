import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { assertExactSourceCachePath, calculateSourceSetSha256 } from "./manifest.mjs";

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
sharp.cache(false);
sharp.concurrency(1);
const sha256Pattern = /^[a-f0-9]{64}$/;

export const researchCourtyardTextureFormat = "graphics-portfolio-research-courtyard-textures";
export const researchCourtyardTextureVersion = 1;
export const requiredSharpVersion = "0.35.4";

export const texturePreprocessContract = Object.freeze({
  width: 1024,
  height: 1024,
  png: Object.freeze({
    compressionLevel: 9,
    adaptiveFiltering: false,
    palette: false,
  }),
  webp: Object.freeze({
    quality: 90,
    effort: 4,
    smartSubsample: false,
    alphaQuality: 100,
  }),
  alphaThreshold: 128,
  toktx: Object.freeze({
    version: "4.4.2",
    baseColorEncoding: "etc1s",
    normalEncoding: "uastc",
    ormEncoding: "etc1s",
    alphaEncoding: "uastc",
  }),
});

export class ResearchCourtyardTextureError extends Error {
  constructor(code, message) {
    super(code + ": " + message);
    this.name = "ResearchCourtyardTextureError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new ResearchCourtyardTextureError(code, message);
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function portable(value) {
  return value.replaceAll(path.sep, "/");
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isSafePortablePath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.includes("\\") &&
    !value.startsWith("/") &&
    !value.split("/").some((part) => part === "" || part === "." || part === "..")
  );
}

function assertExistingDirectory(directory, label) {
  const resolved = path.resolve(directory);
  if (!existsSync(resolved) || !lstatSync(resolved).isDirectory())
    fail("directory", label + " is missing");
  if (lstatSync(resolved).isSymbolicLink()) fail("symlink", label + " is a symlink");
  return resolved;
}

function assertNoSymlinkSegments(root, candidate, label) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  if (!isWithin(resolvedRoot, resolvedCandidate)) fail("path-escape", label + " escaped root");
  assertExistingDirectory(resolvedRoot, label + " root");
  let current = resolvedRoot;
  for (const segment of path.relative(resolvedRoot, resolvedCandidate).split(path.sep)) {
    if (!segment) continue;
    current = path.join(current, segment);
    if (!existsSync(current)) break;
    if (lstatSync(current).isSymbolicLink()) fail("symlink", label + " contains a symlink");
  }
  return resolvedCandidate;
}

function sharpPackageVersion() {
  const require = createRequire(import.meta.url);
  const sharpEntry = require.resolve("sharp");
  const packagePath = path.resolve(path.dirname(sharpEntry), "../package.json");
  return JSON.parse(readFileSync(packagePath, "utf8")).version;
}

function assertSharpVersion() {
  const actual = sharpPackageVersion();
  if (actual !== requiredSharpVersion)
    fail("sharp-version", `expected ${requiredSharpVersion}, received ${String(actual)}`);
  return actual;
}

function assertReviewedSourceLock(sourceLock) {
  if (
    !sourceLock ||
    sourceLock.version !== 3 ||
    !["sources-reviewed", "integrated"].includes(sourceLock.policy?.stage) ||
    sourceLock.policy?.license !== "CC0" ||
    sourceLock.policy?.rawCache !== ".cache/rendering-sources" ||
    sourceLock.sourceSetSha256 !== calculateSourceSetSha256(sourceLock.sources) ||
    !sourceLock.review
  )
    fail("source-lock", "a reviewed v3 source lock is required");
  return sourceLock;
}

function sourceById(sourceLock, sourceId, kind) {
  const matches = (sourceLock.sources ?? []).filter(
    (source) => source.id === sourceId && source.kind === kind,
  );
  if (matches.length !== 1) fail("source", `${sourceId} must resolve to one ${kind} source`);
  return matches[0];
}

function inputReceipt(input) {
  const receipt = { ...input };
  delete receipt.filePath;
  return Object.freeze(receipt);
}

function assertInputFile({ cacheRoot, sourceLock, source, file, colorSpace }) {
  if (!isSafePortablePath(file.relativePath) || !isSafePortablePath(file.cachePath))
    fail("source-path", `${source.id}: unsafe path`);
  if (!sha256Pattern.test(file.sha256 ?? ""))
    fail("source-hash", `${source.id}/${file.relativePath}: missing reviewed SHA-256`);
  try {
    assertExactSourceCachePath(
      sourceLock.policy.rawCache,
      source.id,
      file.relativePath,
      file.cachePath,
      `${source.id}: cache path`,
    );
  } catch (error) {
    fail("source-path", error instanceof Error ? error.message : "invalid source path");
  }
  const prefix = sourceLock.policy.rawCache + "/";
  const filePath = path.resolve(cacheRoot, file.cachePath.slice(prefix.length));
  assertNoSymlinkSegments(cacheRoot, filePath, `${source.id}/${file.relativePath}`);
  if (
    !existsSync(filePath) ||
    !lstatSync(filePath).isFile() ||
    lstatSync(filePath).isSymbolicLink()
  )
    fail("source-file", `${source.id}/${file.relativePath}: missing or unsafe`);
  if (statSync(filePath).size !== file.bytes)
    fail("source-bytes", `${source.id}/${file.relativePath}`);
  const digest = sha256(filePath);
  if (digest !== file.sha256) fail("source-hash", `${source.id}/${file.relativePath}`);
  return Object.freeze({
    filePath,
    sourceId: source.id,
    role: file.role,
    cachePath: file.cachePath,
    path: portable(path.relative(cacheRoot, filePath)),
    bytes: file.bytes,
    sha256: digest,
    colorSpace,
  });
}

function mapInput({ sourceLock, source, cacheRoot, map, role, colorSpace, encoding, normal }) {
  if (
    !map ||
    map.colorSpace !== colorSpace ||
    map.encoding !== encoding ||
    (normal && map.normalConvention !== "opengl-positive-y")
  )
    fail("recipe", `${source.id}/${role}: map contract mismatch`);
  const matches = (source.files ?? []).filter(
    (file) =>
      file.role === role &&
      file.cachePath === map.path &&
      file.sha256 === map.sha256 &&
      file.status === "reviewed",
  );
  if (matches.length !== 1) fail("source-map", `${source.id}/${role}: reviewed map not found`);
  return assertInputFile({
    cacheRoot,
    sourceLock,
    source,
    file: matches[0],
    colorSpace,
  });
}

function buildPlan({ sourceLock, recipe, cacheRoot }) {
  if (!recipe || recipe.sourceSetSha256 !== sourceLock.sourceSetSha256)
    fail("recipe", "recipe must bind the reviewed source-set digest");
  if (!Array.isArray(recipe.materialSources) || recipe.materialSources.length === 0)
    fail("recipe", "materialSources are required");
  const materialIds = new Set();
  const materials = recipe.materialSources.map((material) => {
    if (!/^[a-z0-9-]+$/.test(material.materialId ?? "") || materialIds.has(material.materialId))
      fail("recipe", "material IDs must be safe and unique");
    materialIds.add(material.materialId);
    if (material.sourceId !== material.materialId)
      fail("recipe", `${material.materialId}: source ID mismatch`);
    if (
      !Number.isFinite(material.metallicFactor) ||
      material.metallicFactor < 0 ||
      material.metallicFactor > 1
    )
      fail("recipe", `${material.materialId}: metallic factor must be in [0,1]`);
    if (
      material.orm?.occlusionConstant !== 1 ||
      material.orm?.roughnessSource !== "roughness" ||
      material.orm?.metallicSource !== "metallicFactor"
    )
      fail("recipe", `${material.materialId}: ORM contract mismatch`);
    const source = sourceById(sourceLock, material.sourceId, "texture");
    const maps = material.maps ?? {};
    return Object.freeze({
      id: material.materialId,
      metallicFactor: material.metallicFactor,
      inputs: Object.freeze({
        baseColor: mapInput({
          sourceLock,
          source,
          cacheRoot,
          map: maps.baseColor,
          role: "base-color",
          colorSpace: "srgb",
          encoding: "etc1s",
        }),
        normal: mapInput({
          sourceLock,
          source,
          cacheRoot,
          map: maps.normal,
          role: "normal",
          colorSpace: "linear",
          encoding: "uastc",
          normal: true,
        }),
        roughness: mapInput({
          sourceLock,
          source,
          cacheRoot,
          map: maps.roughness,
          role: "roughness",
          colorSpace: "linear",
          encoding: "etc1s",
        }),
      }),
    });
  });
  const fenceRecipe = (recipe.meshSources ?? []).find(
    (entry) => entry.sourceId === "modular-chainlink-fence",
  );
  const wire = fenceRecipe?.materialOverrides?.find(
    (entry) => entry.materialName === "modular_chainlink_fence_wire",
  );
  if (
    !wire ||
    wire.alphaMode !== "MASK" ||
    wire.alphaCutoff !== 0.5 ||
    wire.doubleSided !== true ||
    wire.renderPass !== "alpha-mask-forward" ||
    wire.alphaSource?.kind !== "max-rgb" ||
    wire.alphaSource?.threshold !== 0.5 ||
    wire.alphaSource?.sourceRole !== "base-color"
  )
    fail("recipe", "fence wire must declare deterministic max-RGB alpha");
  const fenceSource = sourceById(sourceLock, "modular-chainlink-fence", "mesh");
  const expectedName = wire.materialName + "_diff_1k.jpg";
  const wireFiles = (fenceSource.files ?? []).filter(
    (file) => file.role === "gltf-include" && file.relativePath.endsWith("/" + expectedName),
  );
  if (wireFiles.length !== 1) fail("fence-source", "expected one reviewed wire base-color JPEG");
  return Object.freeze({
    materials: Object.freeze([...materials].sort((left, right) => left.id.localeCompare(right.id))),
    fence: Object.freeze({
      id: "fence-wire-basecolor-alpha",
      input: assertInputFile({
        cacheRoot,
        sourceLock,
        source: fenceSource,
        file: wireFiles[0],
        colorSpace: "srgb",
      }),
    }),
  });
}

function assertOutputDirectory({ buildRoot, outputDir, cacheRoot }) {
  const build = assertExistingDirectory(buildRoot, "buildRoot");
  const output = path.resolve(outputDir);
  if (output === build || !isWithin(build, output))
    fail("output-path", "outputDir must be a new child of buildRoot");
  assertNoSymlinkSegments(build, output, "outputDir");
  if (existsSync(output)) fail("output-exists", "refusing to overwrite outputDir");
  const publicRoot = path.join(moduleRoot, "public");
  if (isWithin(publicRoot, output)) fail("output-path", "outputDir must not target public");
  const cache = path.resolve(cacheRoot);
  if (isWithin(cache, output) || isWithin(output, cache))
    fail("output-path", "outputDir must not overlap the reviewed source cache");
  return { build, output };
}

function outputPath(stagingRoot, relative) {
  if (!isSafePortablePath(relative)) fail("output-path", `${relative}: unsafe output`);
  const output = path.resolve(stagingRoot, relative);
  if (!isWithin(stagingRoot, output)) fail("output-path", `${relative}: escaped staging`);
  if (existsSync(output)) fail("output-exists", `${relative}: staging output already exists`);
  mkdirSync(path.dirname(output), { recursive: true });
  return output;
}

function raster(inputPath) {
  return sharp(inputPath, {
    failOn: "error",
    limitInputPixels: 64 * 1024 * 1024,
  })
    .rotate()
    .resize({
      width: texturePreprocessContract.width,
      height: texturePreprocessContract.height,
      fit: "fill",
      kernel: sharp.kernel.lanczos3,
    });
}

async function outputArtifact(stagingRoot, file, colorSpace, channels) {
  if (!existsSync(file) || !lstatSync(file).isFile() || lstatSync(file).isSymbolicLink())
    fail("output-file", `${portable(path.relative(stagingRoot, file))}: missing or unsafe`);
  const metadata = await sharp(file).metadata();
  if (
    metadata.width !== texturePreprocessContract.width ||
    metadata.height !== texturePreprocessContract.height ||
    metadata.channels !== channels
  )
    fail("output-raster", portable(path.relative(stagingRoot, file)));
  return Object.freeze({
    path: portable(path.relative(stagingRoot, file)),
    bytes: statSync(file).size,
    sha256: sha256(file),
    colorSpace,
    width: metadata.width,
    height: metadata.height,
    channels: metadata.channels,
  });
}

function toktxCommand({ id, encoding, colorSpace, normalMap = false }) {
  const inputPath = `intermediate/${id}.png`;
  const outputPath = `ktx2/${id}.ktx2`;
  const args = ["--t2", "--encode", encoding, "--assign_oetf", colorSpace, "--genmipmap"];
  if (normalMap) args.push("--normal_mode");
  args.push(outputPath, inputPath);
  return Object.freeze({
    tool: "toktx",
    version: texturePreprocessContract.toktx.version,
    execution: "not-executed",
    id,
    encoding,
    colorSpace,
    inputPath,
    outputPath,
    args: Object.freeze(args),
  });
}

async function writeRgbPng(input, output) {
  await raster(input).removeAlpha().png(texturePreprocessContract.png).toFile(output);
}

async function writeWebp(input, output, preserveAlpha) {
  let pipeline = sharp(input, { failOn: "error" });
  if (!preserveAlpha) pipeline = pipeline.removeAlpha();
  await pipeline.webp(texturePreprocessContract.webp).toFile(output);
}

async function writeOrmPng(input, metallicFactor, output) {
  const { data, info } = await raster(input)
    .removeAlpha()
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (
    info.width !== texturePreprocessContract.width ||
    info.height !== texturePreprocessContract.height ||
    info.channels !== 1
  )
    fail("roughness-raster", "expected a one-channel 1024px roughness image");
  const metallic = Math.round(metallicFactor * 255);
  const orm = Buffer.alloc(info.width * info.height * 4);
  for (let source = 0, target = 0; source < data.length; source += 1, target += 4) {
    orm[target] = 255;
    orm[target + 1] = data[source];
    orm[target + 2] = metallic;
    orm[target + 3] = 255;
  }
  await sharp(orm, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png(texturePreprocessContract.png)
    .toFile(output);
}

async function writeFenceAlphaPng(input, output) {
  const { data, info } = await raster(input)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (
    info.width !== texturePreprocessContract.width ||
    info.height !== texturePreprocessContract.height ||
    info.channels !== 3
  )
    fail("fence-raster", "expected a three-channel 1024px wire base color");
  const rgba = Buffer.alloc((data.length / 3) * 4);
  for (let source = 0, target = 0; source < data.length; source += 3, target += 4) {
    const red = data[source];
    const green = data[source + 1];
    const blue = data[source + 2];
    rgba[target] = red;
    rgba[target + 1] = green;
    rgba[target + 2] = blue;
    rgba[target + 3] =
      Math.max(red, green, blue) >= texturePreprocessContract.alphaThreshold ? 255 : 0;
  }
  await sharp(rgba, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png(texturePreprocessContract.png)
    .toFile(output);
}

async function buildMaterial(stagingRoot, material) {
  const paths = {
    base: outputPath(stagingRoot, `intermediate/${material.id}-basecolor.png`),
    normal: outputPath(stagingRoot, `intermediate/${material.id}-normal.png`),
    orm: outputPath(stagingRoot, `intermediate/${material.id}-orm.png`),
    baseWebp: outputPath(stagingRoot, `fallback/${material.id}-basecolor.webp`),
    normalWebp: outputPath(stagingRoot, `fallback/${material.id}-normal.webp`),
    ormWebp: outputPath(stagingRoot, `fallback/${material.id}-orm.webp`),
  };
  await writeRgbPng(material.inputs.baseColor.filePath, paths.base);
  await writeRgbPng(material.inputs.normal.filePath, paths.normal);
  await writeOrmPng(material.inputs.roughness.filePath, material.metallicFactor, paths.orm);
  await writeWebp(paths.base, paths.baseWebp, false);
  await writeWebp(paths.normal, paths.normalWebp, false);
  await writeWebp(paths.orm, paths.ormWebp, false);
  return Object.freeze({
    id: material.id,
    metallicFactor: material.metallicFactor,
    maps: Object.freeze([
      Object.freeze({
        id: "basecolor",
        input: inputReceipt(material.inputs.baseColor),
        intermediate: await outputArtifact(stagingRoot, paths.base, "srgb", 3),
        fallback: await outputArtifact(stagingRoot, paths.baseWebp, "srgb", 3),
        transcode: toktxCommand({
          id: `${material.id}-basecolor`,
          encoding: texturePreprocessContract.toktx.baseColorEncoding,
          colorSpace: "srgb",
        }),
      }),
      Object.freeze({
        id: "normal",
        input: inputReceipt(material.inputs.normal),
        intermediate: await outputArtifact(stagingRoot, paths.normal, "linear", 3),
        fallback: await outputArtifact(stagingRoot, paths.normalWebp, "linear", 3),
        transcode: toktxCommand({
          id: `${material.id}-normal`,
          encoding: texturePreprocessContract.toktx.normalEncoding,
          colorSpace: "linear",
          normalMap: true,
        }),
      }),
      Object.freeze({
        id: "orm",
        inputs: Object.freeze([inputReceipt(material.inputs.roughness)]),
        occlusionConstant: 1,
        metallicByte: Math.round(material.metallicFactor * 255),
        intermediate: await outputArtifact(stagingRoot, paths.orm, "linear", 4),
        fallback: await outputArtifact(stagingRoot, paths.ormWebp, "linear", 3),
        transcode: toktxCommand({
          id: `${material.id}-orm`,
          encoding: texturePreprocessContract.toktx.ormEncoding,
          colorSpace: "linear",
        }),
      }),
    ]),
  });
}

async function buildFence(stagingRoot, fence) {
  const intermediatePath = outputPath(stagingRoot, `intermediate/${fence.id}.png`);
  const fallbackPath = outputPath(stagingRoot, `fallback/${fence.id}.webp`);
  await writeFenceAlphaPng(fence.input.filePath, intermediatePath);
  await writeWebp(intermediatePath, fallbackPath, true);
  return Object.freeze({
    id: fence.id,
    input: inputReceipt(fence.input),
    intermediate: await outputArtifact(stagingRoot, intermediatePath, "srgb", 4),
    fallback: await outputArtifact(stagingRoot, fallbackPath, "srgb", 4),
    alpha: Object.freeze({
      source: "max-rgb",
      threshold: texturePreprocessContract.alphaThreshold,
      cutoff: 0.5,
    }),
    transcode: toktxCommand({
      id: fence.id,
      encoding: texturePreprocessContract.toktx.alphaEncoding,
      colorSpace: "srgb",
    }),
  });
}

function createManifest({ sourceLock, sharpVersion, materials, fence }) {
  return Object.freeze({
    format: researchCourtyardTextureFormat,
    version: researchCourtyardTextureVersion,
    status: "candidate",
    publishable: false,
    sourceSetSha256: sourceLock.sourceSetSha256,
    toolchain: Object.freeze({
      sharp: sharpVersion,
      toktx: texturePreprocessContract.toktx.version,
    }),
    contract: texturePreprocessContract,
    materials,
    fence,
    currentLimit:
      "PNG intermediates and WebP fallbacks are generated here; KTX2 command descriptors are recorded but toktx is intentionally not executed.",
  });
}

export async function preprocessResearchCourtyardTextures({
  sourceLock,
  recipe,
  cacheRoot,
  buildRoot,
  outputDir,
}) {
  const sharpVersion = assertSharpVersion();
  const reviewedLock = assertReviewedSourceLock(sourceLock);
  const cache = assertExistingDirectory(cacheRoot, "cacheRoot");
  const plan = buildPlan({
    sourceLock: reviewedLock,
    recipe,
    cacheRoot: cache,
  });
  const { build, output } = assertOutputDirectory({
    buildRoot,
    outputDir,
    cacheRoot: cache,
  });
  const staging = mkdtempSync(path.join(build, ".courtyard-textures-"));
  let committed = false;
  try {
    const materials = [];
    for (const material of plan.materials) materials.push(await buildMaterial(staging, material));
    const fence = await buildFence(staging, plan.fence);
    const manifest = createManifest({
      sourceLock: reviewedLock,
      sharpVersion,
      materials,
      fence,
    });
    writeFileSync(
      outputPath(staging, "texture-candidate.manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    if (existsSync(output)) fail("output-exists", "outputDir appeared during staging");
    renameSync(staging, output);
    committed = true;
    return Object.freeze({
      outputDir: output,
      manifestPath: path.join(output, "texture-candidate.manifest.json"),
      manifest,
    });
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
          `Texture preprocessing failed (${error instanceof Error ? error.message : "unknown error"}) and staging cleanup also failed.`,
          { cause: cleanupError },
        );
      }
    throw error;
  }
}

function readJson(file, label) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail("json", `${label}: ${error instanceof Error ? error.message : "invalid JSON"}`);
  }
}

export function parseResearchCourtyardTextureArgs(argumentsList) {
  const values = new Map();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const flag = argumentsList[index];
    const value = argumentsList[index + 1];
    if (
      !["--source-lock", "--recipe", "--cache-root", "--build-root", "--output"].includes(flag) ||
      typeof value !== "string" ||
      values.has(flag)
    )
      fail("arguments", "expected unique source-lock, recipe, cache-root, build-root, and output");
    values.set(flag, value);
  }
  const required = ["--source-lock", "--recipe", "--cache-root", "--build-root", "--output"];
  for (const flag of required) if (!values.has(flag)) fail("arguments", `${flag} is required`);
  return Object.freeze({
    sourceLockPath: path.resolve(values.get("--source-lock")),
    recipePath: path.resolve(values.get("--recipe")),
    cacheRoot: path.resolve(values.get("--cache-root")),
    buildRoot: path.resolve(values.get("--build-root")),
    outputDir: path.resolve(values.get("--output")),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseResearchCourtyardTextureArgs(process.argv.slice(2));
    const result = await preprocessResearchCourtyardTextures({
      sourceLock: readJson(args.sourceLockPath, "source lock"),
      recipe: readJson(args.recipePath, "recipe"),
      cacheRoot: args.cacheRoot,
      buildRoot: args.buildRoot,
      outputDir: args.outputDir,
    });
    console.log(
      JSON.stringify({
        outputDir: result.outputDir,
        manifestPath: result.manifestPath,
        sourceSetSha256: result.manifest.sourceSetSha256,
      }),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
