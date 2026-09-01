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
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { assertExactSourceCachePath } from "./manifest.mjs";

export const reviewedCompilerToolchain = Object.freeze({
  gltfTransform: "4.4.2",
  gltfpack: "1.1",
  toktx: "4.4.2",
  sharp: "0.35.4",
});

export const reviewedCourtyardBudgetDefaults = Object.freeze({
  publicRenderingBytes: 20 * 1024 * 1024,
  courtyardGeometryBytes: 3.5 * 1024 * 1024,
  ktx2Bytes: 5 * 1024 * 1024,
  webpFallbackBytes: 3 * 1024 * 1024,
});

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const shaPattern = /^[a-f0-9]{64}$/;
export const sharpWebpHelperPath = path.join(moduleRoot, "scripts/assets/convert-webp.mjs");

const foundationCapabilities = Object.freeze([
  "Processes one explicitly recorded reviewed glTF mesh input.",
  "Generates three gltfpack LOD candidates for that selected mesh.",
  "Encodes one selected base-color texture as ETC1S and one normal texture as UASTC.",
  "Generates matching WebP fallbacks through the version-checked Node Sharp helper.",
]);

const foundationLimitations = Object.freeze([
  "Does not assemble the six-model Research Courtyard.",
  "Does not merge model instances, material assignments, alpha-mask fences, or scene transforms.",
  "Does not emit the runtime packed-scene vertex, index, material, or indirect-command buffers.",
  "Must not be copied to public assets or treated as an integrated runtime scene.",
]);

export class ReviewedCourtyardCompileError extends Error {
  constructor(code, message) {
    super(code + ": " + message);
    this.name = "ReviewedCourtyardCompileError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new ReviewedCourtyardCompileError(code, message);
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function ensureDirectory(root, label) {
  const resolved = path.resolve(root);
  if (!existsSync(resolved) || !lstatSync(resolved).isDirectory())
    fail("directory", label + " is missing");
  return resolved;
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function outputPath(stagingRoot, relative) {
  const candidate = path.resolve(stagingRoot, relative);
  if (!isWithin(stagingRoot, candidate)) fail("output-path", relative + " escaped staging root");
  return candidate;
}

function sourceEntries(sourceLock, cacheRoot) {
  if (
    !sourceLock ||
    sourceLock.version !== 2 ||
    !["sources-reviewed", "integrated"].includes(sourceLock.policy?.stage)
  ) {
    fail("source-lock", "sources-reviewed or integrated source lock is required");
  }
  if (!Array.isArray(sourceLock.sources) || sourceLock.sources.length === 0) {
    fail("source-lock", "sources are required");
  }
  return sourceLock.sources.flatMap((source) => {
    if (!["mesh", "texture", "hdri"].includes(source.kind)) {
      fail("source-lock", String(source.id || "unknown") + ": unsupported source kind");
    }
    if (!Array.isArray(source.files) || source.files.length === 0) {
      fail("source-lock", String(source.id || "unknown") + ": selected files are required");
    }
    return source.files.map((file) => {
      if (file.status !== "reviewed" || !shaPattern.test(file.sha256 || "")) {
        fail("source-lock", String(source.id || "unknown") + ": reviewed SHA-256 is required");
      }
      try {
        assertExactSourceCachePath(
          sourceLock.policy?.rawCache,
          source.id,
          file.relativePath,
          file.cachePath,
          `${source.id || "source"}: cache path`,
        );
      } catch (error) {
        fail("cache-path", error instanceof Error ? error.message : "invalid cache path");
      }
      if (typeof file.cachePath !== "string" || file.cachePath.includes("..")) {
        fail("source-lock", String(source.id || "unknown") + ": unsafe cache path");
      }
      const rawCache = String(sourceLock.policy?.rawCache || "")
        .replaceAll("\\", "/")
        .replace(/\/$/, "");
      if (!rawCache || !String(file.cachePath).startsWith(rawCache + "/")) {
        fail("cache-path", String(file.cachePath) + " does not belong to source-lock raw cache");
      }
      const relativeCacheFile = String(file.cachePath).slice(rawCache.length + 1);
      const resolved = path.resolve(cacheRoot, relativeCacheFile);
      if (!isWithin(cacheRoot, resolved))
        fail("cache-path", file.cachePath + " escaped cache root");
      if (!existsSync(resolved) || !lstatSync(resolved).isFile()) {
        fail("cache-missing", source.id + "/" + file.relativePath);
      }
      if (sha256(resolved) !== file.sha256) fail("cache-hash", source.id + "/" + file.relativePath);
      return { source, file, path: resolved };
    });
  });
}

function preflightTools(toolPaths) {
  const tools = toolPaths?.tools;
  if (!tools || typeof tools !== "object") fail("tool-manifest", "tools are required");
  for (const [key, version] of Object.entries(reviewedCompilerToolchain)) {
    const descriptor = tools[key];
    if (!descriptor || descriptor.version !== version) {
      fail("tool-manifest", key + "@" + version + " is required");
    }
    if (key === "sharp") continue;
    if (typeof descriptor.path !== "string") {
      fail("tool-manifest", key + " executable path is required");
    }
    if (!existsSync(descriptor.path) || !lstatSync(descriptor.path).isFile()) {
      fail("tool-missing", key + ": " + descriptor.path);
    }
  }
  if (!existsSync(sharpWebpHelperPath) || !lstatSync(sharpWebpHelperPath).isFile()) {
    fail("sharp-helper", "convert-webp.mjs is required");
  }
  const sharpDescriptor = tools.sharp;
  const nodePath = sharpDescriptor.nodePath ?? process.execPath;
  if (typeof nodePath !== "string" || !existsSync(nodePath) || !lstatSync(nodePath).isFile()) {
    fail("tool-missing", "sharp Node executable: " + String(nodePath));
  }
  const packageJsonPath =
    sharpDescriptor.packageJsonPath ?? path.join(moduleRoot, "node_modules/sharp/package.json");
  if (
    typeof packageJsonPath !== "string" ||
    !existsSync(packageJsonPath) ||
    !lstatSync(packageJsonPath).isFile()
  ) {
    fail("tool-missing", "sharp package manifest: " + String(packageJsonPath));
  }
  let sharpPackage;
  try {
    sharpPackage = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  } catch {
    fail("sharp-package", "unable to parse " + packageJsonPath);
  }
  if (sharpPackage.version !== reviewedCompilerToolchain.sharp) {
    fail(
      "sharp-version",
      "expected " + reviewedCompilerToolchain.sharp + ", received " + String(sharpPackage.version),
    );
  }
  return {
    ...tools,
    sharp: { ...sharpDescriptor, nodePath, packageJsonPath },
  };
}

function selectInput(entries, kind, role) {
  const entry = entries.find(({ source, file }) => source.kind === kind && file.role === role);
  if (!entry) fail("source-selection", kind + "/" + role + " is required");
  return entry.path;
}

function command(tool, args, output, executor = "cli") {
  return Object.freeze({ tool, args: Object.freeze(args), output, executor });
}

export function createReviewedCourtyardCommandPlan({
  sourceLock,
  cacheRoot,
  toolPaths,
  stagingRoot,
}) {
  const entries = sourceEntries(sourceLock, cacheRoot);
  const tools = preflightTools(toolPaths);
  const mesh = selectInput(entries, "mesh", "gltf");
  const baseColor = selectInput(entries, "texture", "base-color");
  const normal = selectInput(entries, "texture", "normal");
  const pruned = outputPath(stagingRoot, "intermediate/courtyard-pruned.glb");
  const deduped = outputPath(stagingRoot, "intermediate/courtyard-dedup.glb");
  const lod0 = outputPath(stagingRoot, "geometry/research-courtyard-lod0.glb");
  const lod1 = outputPath(stagingRoot, "geometry/research-courtyard-lod1.glb");
  const lod2 = outputPath(stagingRoot, "geometry/research-courtyard-lod2.glb");
  const albedoKtx2 = outputPath(stagingRoot, "textures/courtyard-basecolor.ktx2");
  const normalKtx2 = outputPath(stagingRoot, "textures/courtyard-normal.ktx2");
  const albedoWebp = outputPath(stagingRoot, "textures/courtyard-basecolor.webp");
  const normalWebp = outputPath(stagingRoot, "textures/courtyard-normal.webp");
  const commands = [
    command(tools.gltfTransform.path, ["prune", mesh, pruned], pruned),
    command(tools.gltfTransform.path, ["dedup", pruned, deduped], deduped),
    command(tools.gltfpack.path, ["-i", deduped, "-o", lod0, "-si", "1"], lod0),
    command(tools.gltfpack.path, ["-i", deduped, "-o", lod1, "-si", "0.5"], lod1),
    command(tools.gltfpack.path, ["-i", deduped, "-o", lod2, "-si", "0.25"], lod2),
    command(tools.toktx.path, ["--t2", "--encode", "etc1s", albedoKtx2, baseColor], albedoKtx2),
    command(tools.toktx.path, ["--t2", "--encode", "uastc", normalKtx2, normal], normalKtx2),
    command(
      tools.sharp.nodePath,
      [
        sharpWebpHelperPath,
        "--input",
        baseColor,
        "--output",
        albedoWebp,
        "--expected-sharp-version",
        tools.sharp.version,
      ],
      albedoWebp,
      "node-sharp-helper",
    ),
    command(
      tools.sharp.nodePath,
      [
        sharpWebpHelperPath,
        "--input",
        normal,
        "--output",
        normalWebp,
        "--expected-sharp-version",
        tools.sharp.version,
      ],
      normalWebp,
      "node-sharp-helper",
    ),
  ];
  return Object.freeze({
    commands: Object.freeze(commands),
    artifacts: Object.freeze([
      { role: "lod0", path: lod0 },
      { role: "lod1", path: lod1 },
      { role: "lod2", path: lod2 },
      { role: "albedo-ktx2", path: albedoKtx2 },
      { role: "normal-ktx2", path: normalKtx2 },
      { role: "albedo-webp", path: albedoWebp },
      { role: "normal-webp", path: normalWebp },
    ]),
    foundation: Object.freeze({
      status: "candidate",
      maturity: "foundation",
      publicTarget: "prohibited",
      capabilities: foundationCapabilities,
      limitations: foundationLimitations,
      selectedInputs: Object.freeze({
        mesh: path.relative(cacheRoot, mesh).replaceAll(path.sep, "/"),
        baseColor: path.relative(cacheRoot, baseColor).replaceAll(path.sep, "/"),
        normal: path.relative(cacheRoot, normal).replaceAll(path.sep, "/"),
      }),
    }),
  });
}

function canonicalJson(value) {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value && typeof value === "object") {
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + canonicalJson(value[key]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(value);
}

function normalizeBudget(budget = {}) {
  const result = { ...reviewedCourtyardBudgetDefaults, ...budget };
  for (const [key, value] of Object.entries(result)) {
    if (!Number.isSafeInteger(value) || value < 1)
      fail("budget", key + " must be a positive integer");
  }
  return result;
}

function assertArtifacts(artifacts) {
  return artifacts.map((artifact) => {
    if (!existsSync(artifact.path) || !lstatSync(artifact.path).isFile()) {
      fail("artifact-missing", artifact.role + ": " + artifact.path);
    }
    const bytes = statSync(artifact.path).size;
    if (bytes < 1) fail("artifact-empty", artifact.role + ": " + artifact.path);
    return {
      role: artifact.role,
      path: artifact.path,
      bytes,
      sha256: sha256(artifact.path),
    };
  });
}

function assertBudget(artifacts, budget) {
  const total = artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0);
  const geometry = artifacts
    .filter((artifact) => artifact.role.startsWith("lod"))
    .reduce((sum, artifact) => sum + artifact.bytes, 0);
  const ktx2 = artifacts
    .filter((artifact) => artifact.path.endsWith(".ktx2"))
    .reduce((sum, artifact) => sum + artifact.bytes, 0);
  const webp = artifacts
    .filter((artifact) => artifact.path.endsWith(".webp"))
    .reduce((sum, artifact) => sum + artifact.bytes, 0);
  if (total > budget.publicRenderingBytes) fail("budget", "public rendering bytes exceeded");
  if (geometry > budget.courtyardGeometryBytes) fail("budget", "courtyard geometry bytes exceeded");
  if (ktx2 > budget.ktx2Bytes) fail("budget", "KTX2 bytes exceeded");
  if (webp > budget.webpFallbackBytes) fail("budget", "WebP fallback bytes exceeded");
  return { total, geometry, ktx2, webp };
}

function defaultRunCommand(command) {
  const { tool, args, cwd } = command;
  const result = spawnSync(tool, args, { cwd, encoding: "utf8", shell: false });
  if (result.error || result.status !== 0) {
    fail("tool-command", tool + ": " + String(result.stderr || result.error || "failed"));
  }
}

function checkedOutputRoots({ buildRoot, outputDir }) {
  const root = ensureDirectory(buildRoot, "buildRoot");
  const output = path.resolve(outputDir);
  if (output === root || isWithin(root, output) === false) {
    fail("output-path", "outputDir must be a child of buildRoot");
  }
  if (isWithin(path.join(moduleRoot, "public"), output)) {
    fail("output-path", "outputDir must never target public assets");
  }
  if (existsSync(output)) fail("output-exists", "refusing to overwrite outputDir");
  return { root, output };
}

export function compileReviewedCourtyard({
  sourceLock,
  cacheRoot,
  toolPaths,
  buildRoot,
  outputDir,
  runCommand = defaultRunCommand,
  budget = undefined,
}) {
  const cache = ensureDirectory(cacheRoot, "cacheRoot");
  const { root, output } = checkedOutputRoots({ buildRoot, outputDir });
  // Preflight every reviewed file and every tool before the transaction creates
  // any caller-visible output directory.
  const stagingRoot = mkdtempSync(path.join(root, ".reviewed-courtyard-"));
  let committed = false;
  try {
    const plan = createReviewedCourtyardCommandPlan({
      sourceLock,
      cacheRoot: cache,
      toolPaths,
      stagingRoot,
    });
    writeFileSync(
      outputPath(stagingRoot, "transaction.json"),
      JSON.stringify({ state: "candidate-staging", commands: plan.commands.length }, null, 2) +
        "\n",
    );
    for (const planned of plan.commands) {
      mkdirSync(path.dirname(planned.output), { recursive: true });
      runCommand({ ...planned, cwd: stagingRoot });
      if (!existsSync(planned.output) || !lstatSync(planned.output).isFile()) {
        fail("tool-output", planned.output);
      }
    }
    const artifacts = assertArtifacts(plan.artifacts);
    const totals = assertBudget(artifacts, normalizeBudget(budget));
    const manifest = {
      format: "graphics-portfolio-courtyard-foundation",
      version: 1,
      status: "candidate",
      maturity: "foundation",
      publishable: false,
      placeholder: false,
      sourceLockSha256: createHash("sha256").update(canonicalJson(sourceLock)).digest("hex"),
      toolchain: reviewedCompilerToolchain,
      foundation: plan.foundation,
      artifacts: artifacts
        .map((artifact) => ({
          ...artifact,
          path: path.relative(stagingRoot, artifact.path).replaceAll(path.sep, "/"),
        }))
        .sort((left, right) => left.role.localeCompare(right.role)),
      totals,
    };
    writeFileSync(
      outputPath(stagingRoot, "courtyard-candidate.manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    writeFileSync(
      outputPath(stagingRoot, "transaction.json"),
      JSON.stringify(
        { state: "candidate-committed", manifest: "courtyard-candidate.manifest.json" },
        null,
        2,
      ) + "\n",
    );
    renameSync(stagingRoot, output);
    committed = true;
    return {
      status: "candidate-committed",
      outputDir: output,
      manifest,
      commands: plan.commands,
    };
  } finally {
    if (!committed && existsSync(stagingRoot))
      rmSync(stagingRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.error(
    "Use compileReviewedCourtyard() with explicit reviewed inputs and a caller-owned temporary build directory.",
  );
  process.exitCode = 1;
}
