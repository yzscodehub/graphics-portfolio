import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertExactSourceCachePath,
  assertPathWithinRoot,
  calculateSourceSetSha256,
  isSafePortableRelativePath,
  loadRenderingSourceLock,
  projectRoot,
  resolvePortablePathWithinRoot,
  resolveSourceCachePath,
} from "./manifest.mjs";
import { validateReviewEvidenceDescriptor } from "./approve-source-review.mjs";

const QUARANTINE_ROOT = ".cache/rendering-quarantine";
const reviewIdPattern = /^[a-z0-9][a-z0-9-]{2,63}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;

function digest(bytes, algorithm = "sha256") {
  return createHash(algorithm).update(bytes).digest("hex");
}

function key(sourceId, relativePath) {
  return `${sourceId}/${relativePath}`;
}

function requireReviewedLock(lock) {
  if (
    lock?.version !== 3 ||
    lock?.policy?.stage !== "sources-reviewed" ||
    lock.policy?.license !== "CC0" ||
    lock.policy?.rawCache !== ".cache/rendering-sources" ||
    lock.sourceSetSha256 !== calculateSourceSetSha256(lock.sources) ||
    !reviewIdPattern.test(lock.review?.reviewId ?? "") ||
    !sha256Pattern.test(lock.review?.evidenceSha256 ?? "") ||
    lock.integration !== undefined ||
    Object.hasOwn(lock.policy ?? {}, "downloaded") ||
    Object.hasOwn(lock, "defaults")
  )
    throw new Error("materialization requires a v3 sources-reviewed lock with review evidence.");
}

function canonicalReviewPath(reviewId, sourceId, relativePath) {
  if (!/^[a-z0-9-]+$/.test(sourceId ?? "")) throw new Error("unsafe source id.");
  if (!isSafePortableRelativePath(relativePath)) throw new Error("unsafe source relative path.");
  return `${QUARANTINE_ROOT}/${reviewId}/${sourceId}/${relativePath}`;
}

function readAndValidateReview(root, sourceLock) {
  const evidence = validateReviewEvidenceDescriptor(
    sourceLock,
    { reviewId: sourceLock.review.reviewId },
    { root, evidencePath: sourceLock.review.evidencePath },
  );
  for (const field of ["reviewId", "reviewer", "reviewedAt", "evidencePath", "evidenceSha256"])
    if (sourceLock.review[field] !== evidence[field])
      throw new Error("source lock review evidence has drifted from its descriptor.");
  const reviewId = sourceLock.review.reviewId;
  const reviewPath = resolvePortablePathWithinRoot(
    root,
    `${QUARANTINE_ROOT}/${reviewId}/review.json`,
    "review receipt",
  );
  const reviewRoot = resolvePortablePathWithinRoot(
    root,
    `${QUARANTINE_ROOT}/${reviewId}`,
    "review root",
  );
  assertPathWithinRoot(reviewRoot, reviewPath, "review receipt");
  if (
    !existsSync(reviewPath) ||
    !lstatSync(reviewPath).isFile() ||
    lstatSync(reviewPath).isSymbolicLink()
  )
    throw new Error("review receipt is missing or unsafe.");
  const review = JSON.parse(readFileSync(reviewPath, "utf8"));
  if (
    review?.version !== 2 ||
    review.reviewId !== reviewId ||
    review.sourceSetSha256 !== sourceLock.sourceSetSha256 ||
    !Array.isArray(review.files)
  )
    throw new Error("review receipt does not bind the reviewed source set.");
  const records = new Map();
  for (const record of review.files) {
    const id = key(record?.sourceId, record?.relativePath);
    if (records.has(id)) throw new Error(`${id}: duplicate review record.`);
    records.set(id, record);
  }
  const expectedCount = sourceLock.sources.reduce(
    (count, source) => count + source.files.length,
    0,
  );
  if (review.files.length !== expectedCount || records.size !== expectedCount)
    throw new Error("review receipt inventory does not exactly match the source lock.");
  return { review, records, reviewRoot };
}

/**
 * Copies only hash-verified bytes from an approved quarantine review into the
 * ignored raw cache. The cache root is created in a sibling staging directory
 * and becomes visible only after its complete inventory passes verification.
 */
export function materializeReviewedSources(sourceLock, options = {}) {
  requireReviewedLock(sourceLock);
  const root = options.root || projectRoot;
  const { records, reviewRoot } = readAndValidateReview(root, sourceLock);
  const destination = resolvePortablePathWithinRoot(
    root,
    sourceLock.policy.rawCache,
    "reviewed source cache",
  );
  if (existsSync(destination))
    throw new Error("reviewed source cache already exists; refusing to overwrite it.");
  const parent = path.dirname(destination);
  mkdirSync(parent, { recursive: true });
  const staging = path.join(parent, `.${path.basename(destination)}.staging-${randomUUID()}`);
  let count = 0;
  try {
    mkdirSync(staging, { recursive: true });
    for (const source of sourceLock.sources) {
      for (const file of source.files) {
        const id = key(source.id, file.relativePath);
        const record = records.get(id);
        if (
          !record ||
          record.directUrl !== file.directUrl ||
          record.bytes !== file.bytes ||
          record.md5 !== file.md5 ||
          record.sha256 !== file.sha256 ||
          !sha256Pattern.test(file.sha256 ?? "") ||
          file.status !== "reviewed"
        )
          throw new Error(`${id}: source lock and review receipt disagree.`);
        const reviewPath = canonicalReviewPath(
          sourceLock.review.reviewId,
          source.id,
          file.relativePath,
        );
        if (record.quarantinePath !== reviewPath)
          throw new Error(`${id}: review quarantine path is not canonical.`);
        const sourceFile = resolvePortablePathWithinRoot(root, reviewPath, `${id} quarantine file`);
        assertPathWithinRoot(reviewRoot, sourceFile, `${id} quarantine file`);
        if (
          !existsSync(sourceFile) ||
          !lstatSync(sourceFile).isFile() ||
          lstatSync(sourceFile).isSymbolicLink()
        )
          throw new Error(`${id}: quarantine file is missing or unsafe.`);
        const sourceBytes = readFileSync(sourceFile);
        if (
          sourceBytes.length !== file.bytes ||
          digest(sourceBytes, "md5") !== file.md5 ||
          digest(sourceBytes) !== file.sha256
        )
          throw new Error(`${id}: quarantine file integrity mismatch.`);
        resolveSourceCachePath(
          root,
          sourceLock.policy.rawCache,
          source.id,
          file.cachePath,
          `${id} cache path`,
        );
        assertExactSourceCachePath(
          sourceLock.policy.rawCache,
          source.id,
          file.relativePath,
          file.cachePath,
          `${id} cache path`,
        );
        const relative = path.relative(destination, path.resolve(root, file.cachePath));
        if (relative.startsWith("..") || path.isAbsolute(relative))
          throw new Error(`${id}: cache target escaped the destination.`);
        const target = path.join(staging, relative);
        mkdirSync(path.dirname(target), { recursive: true });
        copyFileSync(sourceFile, target);
        const copied = readFileSync(target);
        if (copied.length !== file.bytes || digest(copied) !== file.sha256)
          throw new Error(`${id}: staged source file verification failed.`);
        count += 1;
      }
    }
    renameSync(staging, destination);
    return { destination, count };
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = materializeReviewedSources(loadRenderingSourceLock(projectRoot));
    console.log(
      `Materialized ${result.count} reviewed source files into ${path.relative(projectRoot, result.destination)}.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
