import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRenderingSourceLock, projectRoot } from "./manifest.mjs";
import {
  assertExactSourceCachePath,
  assertPathWithinRoot,
  isSafePortableRelativePath,
  resolvePortablePathWithinRoot,
  resolveSourceCachePath,
} from "./manifest.mjs";

const REVIEW_ROOT = ".cache/rendering-quarantine";
const reviewIdPattern = /^[a-z0-9][a-z0-9-]{2,63}$/;

function digest(bytes, algorithm) {
  return createHash(algorithm).update(bytes).digest("hex");
}

function key(sourceId, relativePath) {
  return sourceId + "/" + relativePath;
}

function expectedFiles(sourceLock) {
  return sourceLock.sources.flatMap((source) =>
    (source.files || []).map((file) => ({ source, file, id: key(source.id, file.relativePath) })),
  );
}

function safeReviewId(value) {
  if (!reviewIdPattern.test(value || ""))
    throw new Error("review id must be lowercase alphanumeric/hyphen.");
  return value;
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

function canonicalSourceLockHash(sourceLock) {
  return digest(Buffer.from(JSON.stringify(sourceLock)), "sha256");
}

function within(root, target, label) {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error(label + " escaped its allowed root.");
}

function expectedQuarantinePath(reviewId, sourceId, relativePath) {
  if (!/^[a-z0-9-]+$/.test(sourceId ?? "")) throw new Error("unsafe source id");
  if (!isSafePortableRelativePath(relativePath)) throw new Error("unsafe source relative path");
  return [REVIEW_ROOT, reviewId, sourceId, relativePath].join("/");
}

export function approveSourceReview(sourceLock, review, options = {}) {
  requireMetadataLocked(sourceLock, "source review approval");
  const root = options.root || projectRoot;
  const reviewId = safeReviewId(review?.reviewId);
  if (review?.version !== 1 || !Array.isArray(review.files))
    throw new Error("candidate review contract is invalid.");
  if (review.sourceLockSha256 !== canonicalSourceLockHash(sourceLock))
    throw new Error("candidate review was not generated from the current source lock.");

  const expected = expectedFiles(sourceLock);
  if (review.files.length !== expected.length)
    throw new Error("candidate review file inventory is incomplete.");
  const reviewed = new Map();
  for (const record of review.files) {
    const id = key(record.sourceId, record.relativePath);
    if (reviewed.has(id)) throw new Error(id + ": duplicate candidate review record.");
    reviewed.set(id, record);
  }

  const approvedHashes = new Map();
  for (const { source, file, id } of expected) {
    const record = reviewed.get(id);
    if (!record) throw new Error(id + ": missing candidate review record.");
    if (
      record.directUrl !== file.directUrl ||
      record.bytes !== file.bytes ||
      record.md5 !== file.md5
    )
      throw new Error(id + ": candidate metadata drifted from the source lock.");
    resolveSourceCachePath(
      root,
      sourceLock.policy?.rawCache,
      source.id,
      file.cachePath,
      id + ": cache path",
    );
    assertExactSourceCachePath(
      sourceLock.policy?.rawCache,
      source.id,
      file.relativePath,
      file.cachePath,
      id + ": cache path",
    );
    const expectedPath = expectedQuarantinePath(reviewId, source.id, file.relativePath);
    if (record.quarantinePath !== expectedPath)
      throw new Error(id + ": quarantine path does not match the review id and source file.");
    const candidate = resolvePortablePathWithinRoot(root, record.quarantinePath, id);
    assertPathWithinRoot(
      resolvePortablePathWithinRoot(root, `${REVIEW_ROOT}/${reviewId}`, "review root"),
      candidate,
      id,
    );
    if (!existsSync(candidate) || statSync(candidate).size !== file.bytes)
      throw new Error(id + ": quarantine file is missing or has the wrong size.");
    const bytes = readFileSync(candidate);
    if (digest(bytes, "md5") !== file.md5) throw new Error(id + ": quarantine MD5 mismatch.");
    const sha256 = digest(bytes, "sha256");
    if (sha256 !== record.sha256 || !/^[a-f0-9]{64}$/.test(sha256))
      throw new Error(id + ": quarantine SHA-256 mismatch.");
    approvedHashes.set(id, sha256);
  }

  const approved = globalThis.structuredClone(sourceLock);
  approved.policy = {
    ...approved.policy,
    downloaded: false,
    stage: "sources-reviewed",
  };
  approved.defaults = { ...approved.defaults, status: "sources-reviewed" };
  for (const source of approved.sources)
    for (const file of source.files) {
      file.sha256 = approvedHashes.get(key(source.id, file.relativePath));
      file.status = "reviewed";
    }
  return approved;
}

export function writeApprovedSourceReview(sourceLock, review, options = {}) {
  const root = options.root || projectRoot;
  const approved = approveSourceReview(sourceLock, review, { root });
  const reviewId = safeReviewId(review.reviewId);
  const output = options.apply
    ? path.resolve(root, "public/assets/rendering/sources.lock.json")
    : path.resolve(root, REVIEW_ROOT, reviewId, "sources.reviewed.lock.json");
  if (!options.apply && existsSync(output))
    throw new Error("reviewed lock proposal already exists for this review id.");
  within(
    options.apply ? path.resolve(root, "public/assets/rendering") : path.resolve(root, REVIEW_ROOT),
    output,
    "approved source lock output",
  );
  mkdirSync(path.dirname(output), { recursive: true });
  const serialized = JSON.stringify(approved, null, 2) + "\n";
  const temporary = `${output}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temporary, serialized, { flag: "wx" });
    renameSync(temporary, output);
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
  return { approved, output };
}

function cliArguments(argv) {
  if (argv[0] === "--") argv = argv.slice(1);
  const reviewIndex = argv.indexOf("--review");
  const reviewFile = reviewIndex >= 0 ? argv[reviewIndex + 1] : undefined;
  const apply = argv.includes("--apply");
  const expectedLength = apply ? 3 : 2;
  if (!reviewFile || argv.length !== expectedLength)
    throw new Error("Usage: approve-source-review.mjs --review <review.json> [--apply]");
  return { reviewFile, apply };
}

export { cliArguments as parseApproveSourceReviewArguments };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { reviewFile, apply } = cliArguments(process.argv.slice(2));
    const approvedReviewPath = resolvePortablePathWithinRoot(
      projectRoot,
      reviewFile,
      "review file",
    );
    assertPathWithinRoot(
      resolvePortablePathWithinRoot(projectRoot, REVIEW_ROOT, "review root"),
      approvedReviewPath,
      "review file",
    );
    const reviewPath = path.resolve(projectRoot, reviewFile);
    if (reviewPath !== approvedReviewPath) throw new Error("review file escaped its allowed root.");
    within(path.resolve(projectRoot, REVIEW_ROOT), reviewPath, "review file");
    const review = JSON.parse(readFileSync(reviewPath, "utf8"));
    const sourceLock = loadRenderingSourceLock(projectRoot);
    const result = writeApprovedSourceReview(sourceLock, review, {
      root: projectRoot,
      apply,
    });
    console.log(
      (apply ? "Applied reviewed source lock: " : "Wrote reviewed lock proposal: ") +
        path.relative(projectRoot, result.output),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
