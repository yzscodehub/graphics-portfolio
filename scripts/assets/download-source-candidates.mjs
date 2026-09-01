import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRenderingSourceLock, projectRoot } from "./manifest.mjs";
import {
  assertExactSourceCachePath,
  isSafePortableRelativePath,
  resolvePortablePathWithinRoot,
  resolveSourceCachePath,
} from "./manifest.mjs";

const QUARANTINE_ROOT = ".cache/rendering-quarantine";
const REVIEW_FILE = "review.json";
const reviewIdPattern = /^[a-z0-9][a-z0-9-]{2,63}$/;

function digest(bytes, algorithm) {
  return createHash(algorithm).update(bytes).digest("hex");
}

function safeRelativePath(value) {
  return isSafePortableRelativePath(value);
}

function officialUrl(value) {
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

function selectedFiles(source) {
  if (!Array.isArray(source.files) || source.files.length === 0)
    throw new Error(String(source.id) + ": selected source files are required.");
  return source.files;
}

function requireMetadataLocked(sourceLock, operation) {
  if (
    sourceLock?.policy?.stage !== "metadata-locked" ||
    sourceLock.policy?.downloaded !== false ||
    sourceLock?.defaults?.status !== "metadata-locked"
  )
    throw new Error(
      operation +
        " requires a metadata-locked source lock; reviewed or integrated locks are immutable.",
    );
}

function candidateRoot(root, reviewId) {
  if (!reviewIdPattern.test(reviewId))
    throw new Error("review id must be lowercase alphanumeric/hyphen.");
  return resolvePortablePathWithinRoot(
    root,
    `${QUARANTINE_ROOT}/${reviewId}`,
    "candidate quarantine root",
  );
}

function quarantineTarget(root, sourceId, relativePath) {
  if (!/^[a-z0-9-]+$/.test(sourceId)) throw new Error("unsafe source id");
  if (!safeRelativePath(relativePath)) throw new Error("unsafe source relative path");
  const sourceRoot = resolvePortablePathWithinRoot(root, sourceId, "candidate source root");
  return resolvePortablePathWithinRoot(sourceRoot, relativePath, "candidate source relative path");
}

export async function downloadSourceCandidates(sourceLock, options = {}) {
  requireMetadataLocked(sourceLock, "candidate download");
  const root = options.root || projectRoot;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const reviewId = options.reviewId;
  const directory = candidateRoot(root, reviewId);
  if (existsSync(directory))
    throw new Error("review quarantine already exists; use a new review id");
  const records = [];
  for (const source of sourceLock.sources) {
    for (const file of selectedFiles(source)) {
      if (!officialUrl(file.directUrl))
        throw new Error("direct URL is outside dl.polyhaven.org allowlist.");
      const target = quarantineTarget(directory, source.id, file.relativePath);
      resolveSourceCachePath(
        root,
        sourceLock.policy?.rawCache,
        source.id,
        file.cachePath,
        "candidate cache path",
      );
      assertExactSourceCachePath(
        sourceLock.policy?.rawCache,
        source.id,
        file.relativePath,
        file.cachePath,
        "candidate cache path",
      );
      const response = await fetchImpl(file.directUrl, {
        redirect: "error",
        signal: options.signal,
      });
      if (!response.ok)
        throw new Error(String(source.id) + "/" + file.relativePath + ": HTTP " + response.status);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length !== file.bytes)
        throw new Error(String(source.id) + "/" + file.relativePath + ": byte-size mismatch");
      if (digest(bytes, "md5") !== file.md5)
        throw new Error(String(source.id) + "/" + file.relativePath + ": MD5 mismatch");
      const escaped = path.relative(directory, target);
      if (escaped.startsWith("..") || path.isAbsolute(escaped))
        throw new Error("quarantine path escaped review root");
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, bytes);
      records.push({
        sourceId: source.id,
        relativePath: file.relativePath,
        directUrl: file.directUrl,
        bytes: bytes.length,
        md5: file.md5,
        sha256: digest(bytes, "sha256"),
        quarantinePath: path.relative(root, target).replaceAll(path.sep, "/"),
      });
    }
  }
  records.sort((left, right) =>
    (left.sourceId + "/" + left.relativePath).localeCompare(
      right.sourceId + "/" + right.relativePath,
    ),
  );
  const review = {
    version: 1,
    reviewId,
    sourceLockSha256: digest(Buffer.from(JSON.stringify(sourceLock)), "sha256"),
    files: records,
  };
  const reviewPath = path.join(directory, REVIEW_FILE);
  writeFileSync(reviewPath, JSON.stringify(review, null, 2) + "\n");
  return { review, reviewPath };
}

function reviewIdArgument(argv) {
  if (argv[0] === "--") argv = argv.slice(1);
  const index = argv.indexOf("--review-id");
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (!value || index + 2 !== argv.length)
    throw new Error("Usage: download-source-candidates.mjs --review-id <lowercase-id>");
  return value;
}

export { reviewIdArgument as parseDownloadSourceCandidateArguments };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const reviewId = reviewIdArgument(process.argv.slice(2));
    const sourceLock = loadRenderingSourceLock(projectRoot);
    const { reviewPath, review } = await downloadSourceCandidates(sourceLock, { reviewId });
    console.log(
      "Downloaded " +
        review.files.length +
        " candidate files. Review report: " +
        path.relative(projectRoot, reviewPath),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
