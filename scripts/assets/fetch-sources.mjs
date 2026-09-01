import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRenderingSourceLock, projectRoot } from "./manifest.mjs";
import {
  assertExactSourceCachePath,
  isSafePortableRelativePath,
  resolveSourceCachePath,
} from "./manifest.mjs";

const cacheRoot = path.join(projectRoot, ".cache", "rendering-sources");
const shaPattern = /^[a-f0-9]{64}$/;

function sourceFiles(source) {
  return Array.isArray(source.files) ? source.files : [];
}

export function findFetchBlockers(sourceLock) {
  const stage = sourceLock.policy?.stage;
  const stageStateIsValid =
    (stage === "sources-reviewed" && sourceLock.policy?.downloaded === false) ||
    (stage === "integrated" && sourceLock.policy?.downloaded === true);
  const stageBlockers = [];
  if (!stageStateIsValid || sourceLock.defaults?.status !== "sources-reviewed") {
    stageBlockers.push("source lock: approved stage and download state");
  }
  const fileBlockers = sourceLock.sources.flatMap((source) => {
    const files = sourceFiles(source);
    if (!files.length) return [source.id + ": selected files"];
    return files.flatMap((file) => {
      const label = source.id + "/" + (file.relativePath || "unknown");
      const blockers = [];
      if (!String(file.directUrl || "").startsWith("https://dl.polyhaven.org/file/"))
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

export async function fetchReviewedSources(sourceLock, destination = projectRoot) {
  const blockers = findFetchBlockers(sourceLock);
  if (blockers.length) throw new Error("Missing " + blockers.join(", ") + ".");
  for (const source of sourceLock.sources) {
    for (const file of sourceFiles(source)) {
      const response = await globalThis.fetch(file.directUrl, { redirect: "error" });
      if (!response.ok)
        throw new Error(source.id + "/" + file.relativePath + ": HTTP " + response.status);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length !== file.bytes)
        throw new Error(source.id + "/" + file.relativePath + ": byte-size mismatch");
      const actualHash = createHash("sha256").update(bytes).digest("hex");
      if (actualHash !== file.sha256)
        throw new Error(source.id + "/" + file.relativePath + ": SHA-256 mismatch");
      const target = path.resolve(destination, file.cachePath);
      const relative = path.relative(destination, target);
      if (relative.startsWith("..") || path.isAbsolute(relative))
        throw new Error(source.id + "/" + file.relativePath + ": cache path escaped destination");
      const authorizedTarget = resolveSourceCachePath(
        destination,
        sourceLock.policy?.rawCache,
        source.id,
        file.cachePath,
        source.id + "/" + file.relativePath + ": cache path",
      );
      if (path.resolve(target) !== authorizedTarget)
        throw new Error(source.id + "/" + file.relativePath + ": cache path escaped destination");
      assertExactSourceCachePath(
        sourceLock.policy?.rawCache,
        source.id,
        file.relativePath,
        file.cachePath,
        source.id + "/" + file.relativePath + ": cache path",
      );
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, bytes);
    }
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
    await fetchReviewedSources(sourceLock);
    console.log(
      "Fetched reviewed source files into " + path.relative(projectRoot, cacheRoot) + ".",
    );
  }
}
