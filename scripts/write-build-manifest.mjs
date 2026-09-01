import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveSiteStage, resolveSourceRef } from "../src/data/site-stage.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const buildManifestFileName = "build-manifest.json";

const requiredInputs = Object.freeze({
  pnpmLock: "pnpm-lock.yaml",
  renderingSourceLock: "public/assets/rendering/sources.lock.json",
  renderingAssetManifest: "public/assets/rendering/manifest.json",
  renderingAcceptanceManifest: "public/evidence/rendering-v2-acceptance.json",
  neuralModelManifest: "public/models/neural-denoiser.manifest.json",
});

export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function describeFile(root, relativePath) {
  const file = path.resolve(root, relativePath);
  if (!existsSync(file))
    throw new Error(`Required build identity input is missing: ${relativePath}`);
  const details = lstatSync(file);
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error(`Build identity input must be a regular file: ${relativePath}`);
  }
  const bytes = readFileSync(file);
  return Object.freeze({
    path: relativePath.replaceAll(path.sep, "/"),
    bytes: bytes.length,
    sha256: sha256Bytes(bytes),
  });
}

function walkRegularFiles(directory, relativeDirectory = "") {
  if (!existsSync(directory)) throw new Error(`Build output directory is missing: ${directory}`);
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkRegularFiles(absolutePath, relativePath));
      continue;
    }
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(`Build output must not contain non-regular files: ${relativePath}`);
    }
    files.push({ absolutePath, relativePath });
  }
  return files;
}

export function describeDist(root) {
  const distRoot = path.join(root, "dist");
  const hash = createHash("sha256");
  let bytes = 0;
  let files = 0;
  for (const file of walkRegularFiles(distRoot)) {
    if (file.relativePath === buildManifestFileName) continue;
    const contents = readFileSync(file.absolutePath);
    hash.update(file.relativePath, "utf8");
    hash.update("\0", "utf8");
    hash.update(String(contents.length), "utf8");
    hash.update("\0", "utf8");
    hash.update(contents);
    hash.update("\0", "utf8");
    bytes += contents.length;
    files += 1;
  }
  return Object.freeze({
    sha256: hash.digest("hex"),
    bytes,
    files,
    excluded: [buildManifestFileName],
  });
}

export function resolveGitIdentity(root = projectRoot) {
  const safeRoot = root.replaceAll("\\", "/");
  try {
    const commit = execFileSync("git", ["-c", `safe.directory=${safeRoot}`, "rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    const status = execFileSync(
      "git",
      ["-c", `safe.directory=${safeRoot}`, "status", "--porcelain=v1", "--untracked-files=normal"],
      { cwd: root, encoding: "utf8" },
    );
    const sourcePaths = execFileSync(
      "git",
      ["-c", `safe.directory=${safeRoot}`, "ls-files", "-co", "--exclude-standard", "-z"],
      { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    )
      .split("\0")
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right));
    const sourceHash = createHash("sha256");
    for (const relativePath of sourcePaths) {
      const absolutePath = path.resolve(root, relativePath);
      const escaped = path.relative(root, absolutePath);
      if (escaped.startsWith("..") || path.isAbsolute(escaped)) {
        throw new Error(`git source path escaped the project root: ${relativePath}`);
      }
      const details = lstatSync(absolutePath);
      if (!details.isFile() || details.isSymbolicLink()) {
        throw new Error(`git source identity requires regular files: ${relativePath}`);
      }
      const contents = readFileSync(absolutePath);
      sourceHash.update(relativePath.replaceAll(path.sep, "/"), "utf8");
      sourceHash.update("\0", "utf8");
      sourceHash.update(String(contents.length), "utf8");
      sourceHash.update("\0", "utf8");
      sourceHash.update(contents);
      sourceHash.update("\0", "utf8");
    }
    if (!/^[a-f0-9]{40}$/i.test(commit)) throw new Error("git did not return a full commit SHA");
    return Object.freeze({
      commit,
      dirty: status.trim().length > 0,
      treeSha256: sourceHash.digest("hex"),
      files: sourcePaths.length,
    });
  } catch (error) {
    throw new Error(
      `Unable to resolve the Git identity for the build manifest: ${error instanceof Error ? error.message : error}`,
      { cause: error },
    );
  }
}

function inputDescriptors(root) {
  return Object.fromEntries(
    Object.entries(requiredInputs).map(([name, relativePath]) => [
      name,
      describeFile(root, relativePath),
    ]),
  );
}

function readJsonInput(root, relativePath, label) {
  try {
    return JSON.parse(readFileSync(path.resolve(root, relativePath), "utf8"));
  } catch (error) {
    throw new Error(
      `Unable to read ${label} for the build summary: ${error instanceof Error ? error.message : error}`,
      { cause: error },
    );
  }
}

function stringField(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Build summary requires ${label}.`);
  }
  return value;
}

export function createBuildManifest({
  root = projectRoot,
  environment = process.env,
  git = resolveGitIdentity(root),
} = {}) {
  const stage = resolveSiteStage(environment.SITE_STAGE);
  return Object.freeze({
    version: 1,
    stage,
    git: {
      commit: git.commit,
      dirty: git.dirty,
      treeSha256: git.treeSha256,
      files: git.files,
    },
    sourceRef: resolveSourceRef(environment.SOURCE_REF, stage),
    inputs: inputDescriptors(root),
    dist: describeDist(root),
    summary: buildSummary(root),
  });
}

export function writeBuildManifest(options = {}) {
  const root = options.root ?? projectRoot;
  const output = path.join(root, "dist", buildManifestFileName);
  mkdirSync(path.dirname(output), { recursive: true });
  const manifest = createBuildManifest({ ...options, root });
  writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

export function verifyBuildManifest(options = {}) {
  const root = options.root ?? projectRoot;
  const output = path.join(root, "dist", buildManifestFileName);
  if (!existsSync(output))
    throw new Error(`Build identity manifest is missing: dist/${buildManifestFileName}`);
  let actual;
  try {
    actual = JSON.parse(readFileSync(output, "utf8"));
  } catch (error) {
    throw new Error(
      `Build identity manifest is invalid JSON: ${error instanceof Error ? error.message : error}`,
      { cause: error },
    );
  }
  const expected = createBuildManifest({ ...options, root });
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      "Build identity manifest does not match the current source inputs or dist output.",
    );
  }
  return actual;
}

function main(argumentsList) {
  if (argumentsList.length > 1 || (argumentsList.length === 1 && argumentsList[0] !== "--verify")) {
    throw new Error("Usage: node scripts/write-build-manifest.mjs [--verify]");
  }
  const manifest = argumentsList[0] === "--verify" ? verifyBuildManifest() : writeBuildManifest();
  console.log(
    `${argumentsList[0] === "--verify" ? "Verified" : "Wrote"} build identity manifest (${manifest.dist.sha256}).`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
function buildSummary(root) {
  const renderingAssets = readJsonInput(
    root,
    requiredInputs.renderingAssetManifest,
    "rendering asset manifest",
  );
  const renderingSources = readJsonInput(
    root,
    requiredInputs.renderingSourceLock,
    "rendering source lock",
  );
  const acceptance = readJsonInput(
    root,
    requiredInputs.renderingAcceptanceManifest,
    "rendering acceptance manifest",
  );
  const neural = readJsonInput(root, requiredInputs.neuralModelManifest, "neural model manifest");
  if (!Array.isArray(acceptance.demos) || !Array.isArray(neural.models)) {
    throw new Error("Build summary requires Demo acceptance and neural model inventories.");
  }
  const demos = acceptance.demos
    .map((entry) => ({
      slug: stringField(entry?.slug, "acceptance Demo slug"),
      status: stringField(entry?.status, "acceptance Demo status"),
    }))
    .sort((left, right) => left.slug.localeCompare(right.slug));
  const guided = neural.models.find((entry) => entry?.id === "guided");
  return Object.freeze({
    rendering: {
      assetStatus: stringField(renderingAssets.status, "rendering asset status"),
      sourceLockStage: stringField(renderingSources.policy?.stage, "rendering source-lock stage"),
    },
    acceptance: {
      status: stringField(acceptance.status, "rendering acceptance status"),
      hasReviewedRun:
        acceptance.reviewedRun !== null &&
        typeof acceptance.reviewedRun === "object" &&
        !Array.isArray(acceptance.reviewedRun),
      demos,
    },
    neural: {
      version: neural.version,
      guidedStatus: stringField(guided?.status, "guided model status"),
    },
  });
}
