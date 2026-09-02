import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRenderingSourceLock, projectRoot } from "./manifest.mjs";
import {
  assertExactSourceCachePath,
  calculateSourceSetSha256,
  isSafePortableRelativePath,
  resolvePortablePathWithinRoot,
  resolveSourceCachePath,
} from "./manifest.mjs";

const shaPattern = /^[a-f0-9]{64}$/;

function sourceFiles(source) {
  return Array.isArray(source.files) ? source.files : [];
}

function isOfficialPolyHavenDownload(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "dl.polyhaven.org" &&
      url.pathname.startsWith("/file/")
    );
  } catch {
    return false;
  }
}

export function findFetchBlockers(sourceLock) {
  const stage = sourceLock.policy?.stage;
  const stageBlockers = [];
  if (
    sourceLock?.version !== 3 ||
    !["sources-reviewed", "integrated"].includes(stage) ||
    sourceLock.policy?.license !== "CC0" ||
    sourceLock.policy?.rawCache !== ".cache/rendering-sources" ||
    sourceLock.sourceSetSha256 !== calculateSourceSetSha256(sourceLock.sources) ||
    !sourceLock.review ||
    Object.hasOwn(sourceLock.policy ?? {}, "downloaded") ||
    Object.hasOwn(sourceLock, "defaults")
  )
    stageBlockers.push("source lock: v3 reviewed stage and source-set receipt");
  const fileBlockers = sourceLock.sources.flatMap((source) => {
    const files = sourceFiles(source);
    if (!files.length) return [source.id + ": selected files"];
    return files.flatMap((file) => {
      const label = source.id + "/" + (file.relativePath || "unknown");
      const blockers = [];
      if (!isOfficialPolyHavenDownload(file.directUrl))
        blockers.push(label + ": official direct HTTPS URL");
      if (!shaPattern.test(file.sha256 || "") || file.status !== "reviewed")
        blockers.push(label + ": reviewed SHA-256");
      if (
        !String(file.cachePath || "").startsWith(".cache/rendering-sources/" + source.id + "/") ||
        String(file.cachePath || "")
          .split("/")
          .includes("..")
      )
        blockers.push(label + ": safe cache path");
      try {
        if (!isSafePortableRelativePath(file.relativePath))
          throw new Error("unsafe source relative path");
        resolveSourceCachePath(
          projectRoot,
          sourceLock.policy?.rawCache,
          source.id,
          file.cachePath,
          label + ": cache path",
        );
        assertExactSourceCachePath(
          sourceLock.policy?.rawCache,
          source.id,
          file.relativePath,
          file.cachePath,
          label + ": cache path",
        );
      } catch {
        blockers.push(label + ": safe source/cache path");
      }
      return blockers;
    });
  });
  return [...stageBlockers, ...fileBlockers];
}

/**
 * Explicit reproducibility fetch. It never replaces the reviewed-quarantine
 * materialization path, and it publishes no cache bytes until the full source
 * inventory has been hash-verified in a sibling staging directory.
 */
export async function fetchReviewedSources(sourceLock, destination = projectRoot, options = {}) {
  const blockers = findFetchBlockers(sourceLock);
  if (blockers.length) throw new Error("Missing " + blockers.join(", ") + ".");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const cacheDirectory = resolvePortablePathWithinRoot(
    destination,
    sourceLock.policy.rawCache,
    "source cache root",
  );
  if (existsSync(cacheDirectory))
    throw new Error("reviewed source cache already exists; refusing to overwrite it.");
  const staging = path.join(
    path.dirname(cacheDirectory),
    `.${path.basename(cacheDirectory)}.fetch-staging-${randomUUID()}`,
  );
  try {
    mkdirSync(staging, { recursive: true });
    for (const source of sourceLock.sources) {
      for (const file of sourceFiles(source)) {
        const response = await fetchImpl(file.directUrl, { redirect: "error" });
        if (!response.ok)
          throw new Error(source.id + "/" + file.relativePath + ": HTTP " + response.status);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length !== file.bytes)
          throw new Error(source.id + "/" + file.relativePath + ": byte-size mismatch");
        const actualHash = createHash("sha256").update(bytes).digest("hex");
        if (actualHash !== file.sha256)
          throw new Error(source.id + "/" + file.relativePath + ": SHA-256 mismatch");
        const authorizedTarget = resolveSourceCachePath(
          destination,
          sourceLock.policy?.rawCache,
          source.id,
          file.cachePath,
          source.id + "/" + file.relativePath + ": cache path",
        );
        const relative = path.relative(cacheDirectory, authorizedTarget);
        if (relative.startsWith("..") || path.isAbsolute(relative))
          throw new Error(source.id + "/" + file.relativePath + ": cache path escaped destination");
        assertExactSourceCachePath(
          sourceLock.policy?.rawCache,
          source.id,
          file.relativePath,
          file.cachePath,
          source.id + "/" + file.relativePath + ": cache path",
        );
        const target = path.join(staging, relative);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, bytes, { flag: "wx" });
      }
    }
    renameSync(staging, cacheDirectory);
    return cacheDirectory;
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sourceLock = loadRenderingSourceLock(projectRoot);
  const blockers = findFetchBlockers(sourceLock);
  if (blockers.length) {
    console.error(
      "Refusing external asset fetch until every selected file has reviewed provenance:",
    );
    blockers.forEach((blocker) => console.error("- " + blocker));
    process.exitCode = 1;
  }
  if (!blockers.length) {
    const cacheRoot = await fetchReviewedSources(sourceLock);
    console.log(
      "Fetched reviewed source files into " + path.relative(projectRoot, cacheRoot) + ".",
    );
  }
}
