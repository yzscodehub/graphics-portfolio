import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  throw new Error(`Courtyard review build: ${message}`);
}

function digest(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function within(parent, candidate) {
  const relation = path.relative(path.resolve(parent), path.resolve(candidate));
  return relation === "" || (!relation.startsWith("..") && !path.isAbsolute(relation));
}

function safeRelative(parent, relative) {
  if (
    typeof relative !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(relative) ||
    relative.includes("\\") ||
    relative.split("/").some((part) => !part || part === "." || part === "..")
  )
    fail(`unsafe candidate path ${String(relative)}`);
  const file = path.resolve(parent, relative);
  if (!within(parent, file)) fail(`candidate path escaped: ${relative}`);
  return file;
}

function candidate(directory) {
  directory = path.resolve(directory);
  if (
    !within(path.join(root, ".cache"), directory) ||
    !existsSync(directory) ||
    !lstatSync(directory).isDirectory() ||
    lstatSync(directory).isSymbolicLink()
  )
    fail("candidate must be a real directory below .cache");
  const manifestPath = path.join(directory, "candidate.manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    fail(error instanceof Error ? error.message : "invalid candidate manifest");
  }
  if (
    manifest.status !== "candidate" ||
    manifest.publishable !== false ||
    !Array.isArray(manifest.files) ||
    !manifest.runtimeManifest
  )
    fail("candidate is not a non-publishable complete build");
  for (const receipt of manifest.files) {
    const file = safeRelative(directory, receipt.uri);
    if (
      !existsSync(file) ||
      !lstatSync(file).isFile() ||
      lstatSync(file).isSymbolicLink() ||
      statSync(file).size !== receipt.bytes ||
      digest(file) !== receipt.sha256
    )
      fail(`${receipt.uri} does not match its receipt`);
  }
  return { directory, manifestPath, manifest };
}

function buildAstro() {
  const windows = process.platform === "win32";
  const executable = windows ? process.env.ComSpec || "cmd.exe" : "pnpm";
  const argumentsList = windows ? ["/d", "/s", "/c", "pnpm.cmd", "run", "build"] : ["run", "build"];
  const result = spawnSync(executable, argumentsList, {
    cwd: root,
    stdio: "inherit",
    shell: false,
    windowsHide: true,
    env: {
      ...process.env,
      SITE_STAGE: "preview",
      COURTYARD_REVIEW: "1",
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) fail(`Astro build exited ${String(result.status)}`);
}

function refreshBuildManifest() {
  const result = spawnSync(process.execPath, ["scripts/write-build-manifest.mjs"], {
    cwd: root,
    stdio: "inherit",
    shell: false,
    windowsHide: true,
    env: {
      ...process.env,
      SITE_STAGE: "preview",
      COURTYARD_REVIEW: "1",
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) fail(`build manifest refresh exited ${String(result.status)}`);
}

export function overlayCandidateForReview(input, dist = path.join(root, "dist")) {
  const reviewPage = path.join(dist, "review/research-courtyard/index.html");
  if (!existsSync(reviewPage)) fail("gated review page was not generated");
  const target = path.join(dist, "assets/rendering/research-courtyard");
  if (existsSync(target)) fail("review overlay target already exists after clean build");
  mkdirSync(target, { recursive: true });
  for (const receipt of input.manifest.files) {
    const source = safeRelative(input.directory, receipt.uri);
    const output = safeRelative(target, receipt.uri);
    mkdirSync(path.dirname(output), { recursive: true });
    copyFileSync(source, output);
  }
  copyFileSync(input.manifestPath, path.join(target, "candidate.manifest.json"));
  writeFileSync(
    path.join(dist, "courtyard-review-build.json"),
    `${JSON.stringify(
      {
        version: 1,
        candidateManifestSha256: digest(input.manifestPath),
        candidateArtifactsSha256: input.manifest.candidateArtifactsSha256,
        route: "/graphics-portfolio/review/research-courtyard/",
      },
      null,
      2,
    )}\n`,
  );
}

function parseArguments(argumentsList) {
  if (argumentsList[0] === "--") argumentsList = argumentsList.slice(1);
  if (
    argumentsList.length !== 2 ||
    argumentsList[0] !== "--candidate" ||
    typeof argumentsList[1] !== "string"
  )
    fail("usage: build-courtyard-review.mjs --candidate DIR");
  return path.resolve(argumentsList[1]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const input = candidate(parseArguments(process.argv.slice(2)));
    buildAstro();
    overlayCandidateForReview(input);
    refreshBuildManifest();
    console.log(
      "Courtyard review ready at http://127.0.0.1:4173/graphics-portfolio/review/research-courtyard/",
    );
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  }
}
