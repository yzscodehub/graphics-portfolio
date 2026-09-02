import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPathWithinRoot,
  calculateSourceSetSha256,
  isSafePortableRelativePath,
  loadRenderingSourceLock,
  projectRoot,
  resolvePortablePathWithinRoot,
} from "./manifest.mjs";

const QUARANTINE_ROOT = ".cache/rendering-quarantine";
const reviewIdPattern = /^[a-z0-9][a-z0-9-]{2,63}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const md5Pattern = /^[a-f0-9]{32}$/;

function digest(bytes, algorithm = "sha256") {
  return createHash(algorithm).update(bytes).digest("hex");
}

function key(sourceId, relativePath) {
  return `${sourceId}/${relativePath}`;
}

function safeReviewId(value) {
  if (!reviewIdPattern.test(value ?? ""))
    throw new Error("review id must be lowercase alphanumeric/hyphen.");
  return value;
}

function requireMetadataLocked(lock) {
  if (
    lock?.version !== 3 ||
    lock?.policy?.stage !== "metadata-locked" ||
    lock.policy?.license !== "CC0" ||
    lock.policy?.rawCache !== ".cache/rendering-sources" ||
    lock.sourceSetSha256 !== calculateSourceSetSha256(lock.sources) ||
    lock.review !== undefined ||
    lock.integration !== undefined ||
    Object.hasOwn(lock.policy ?? {}, "downloaded") ||
    Object.hasOwn(lock, "defaults")
  )
    throw new Error("rebind requires an unpromoted v3 metadata-locked source lock.");
}

function expectedQuarantinePath(reviewId, sourceId, relativePath) {
  if (!/^[a-z0-9-]+$/.test(sourceId ?? "")) throw new Error("unsafe source id.");
  if (!isSafePortableRelativePath(relativePath)) throw new Error("unsafe source relative path.");
  return `${QUARANTINE_ROOT}/${reviewId}/${sourceId}/${relativePath}`;
}

function verifyLegacyReview(root, sourceLock, review) {
  if (
    review?.version !== 1 ||
    !reviewIdPattern.test(review.reviewId ?? "") ||
    !sha256Pattern.test(review.sourceLockSha256 ?? "") ||
    !Array.isArray(review.files)
  )
    throw new Error("legacy review.json must use the v1 candidate-review contract.");
  const expected = sourceLock.sources.flatMap((source) =>
    source.files.map((file) => ({ source, file, id: key(source.id, file.relativePath) })),
  );
  if (review.files.length !== expected.length)
    throw new Error("legacy review file inventory is incomplete.");
  const records = new Map();
  for (const record of review.files) {
    const id = key(record?.sourceId, record?.relativePath);
    if (records.has(id)) throw new Error(`${id}: duplicate legacy review record.`);
    records.set(id, record);
  }
  const verified = [];
  for (const { source, file, id } of expected) {
    const record = records.get(id);
    if (!record) throw new Error(`${id}: missing legacy review record.`);
    if (
      record.directUrl !== file.directUrl ||
      record.bytes !== file.bytes ||
      record.md5 !== file.md5 ||
      !sha256Pattern.test(record.sha256 ?? "")
    )
      throw new Error(`${id}: legacy review metadata drifted from the v3 source set.`);
    const expectedPath = expectedQuarantinePath(review.reviewId, source.id, file.relativePath);
    if (record.quarantinePath !== expectedPath)
      throw new Error(`${id}: legacy quarantine path is not canonical.`);
    const candidate = resolvePortablePathWithinRoot(root, expectedPath, `${id} legacy quarantine`);
    const reviewRoot = resolvePortablePathWithinRoot(
      root,
      `${QUARANTINE_ROOT}/${review.reviewId}`,
      "legacy review root",
    );
    assertPathWithinRoot(reviewRoot, candidate, `${id} legacy quarantine`);
    if (
      !existsSync(candidate) ||
      !lstatSync(candidate).isFile() ||
      lstatSync(candidate).isSymbolicLink()
    )
      throw new Error(`${id}: legacy quarantine file is missing.`);
    const bytes = readFileSync(candidate);
    if (bytes.length !== file.bytes)
      throw new Error(`${id}: legacy quarantine byte-size mismatch.`);
    if (digest(bytes, "md5") !== file.md5 || !md5Pattern.test(file.md5 ?? ""))
      throw new Error(`${id}: legacy quarantine MD5 mismatch.`);
    if (digest(bytes) !== record.sha256)
      throw new Error(`${id}: legacy quarantine SHA-256 mismatch.`);
    verified.push({ source, file, record, bytes });
  }
  return verified;
}

/**
 * Converts an already-downloaded v1 quarantine receipt to the stable v2
 * source-set receipt without re-downloading. It deliberately leaves the
 * formal lock metadata-locked; a human review and explicit approval remain
 * necessary before any source SHA becomes authoritative.
 */
export function rebindLegacySourceReview(sourceLock, legacyReview, options = {}) {
  requireMetadataLocked(sourceLock);
  const root = options.root || projectRoot;
  const newReviewId = safeReviewId(options.reviewId);
  const oldReviewId = safeReviewId(legacyReview?.reviewId);
  if (newReviewId === oldReviewId)
    throw new Error("rebound review id must differ from the legacy review id.");
  const verified = verifyLegacyReview(root, sourceLock, legacyReview);
  const destination = resolvePortablePathWithinRoot(
    root,
    `${QUARANTINE_ROOT}/${newReviewId}`,
    "rebound quarantine root",
  );
  if (existsSync(destination)) throw new Error("rebound review quarantine already exists.");
  const quarantine = resolvePortablePathWithinRoot(root, QUARANTINE_ROOT, "quarantine root");
  const staging = path.join(quarantine, `.${newReviewId}.staging-${randomUUID()}`);
  const records = [];
  try {
    mkdirSync(staging, { recursive: true });
    for (const { source, file, record, bytes } of verified) {
      const relative = `${source.id}/${file.relativePath}`;
      const target = path.join(staging, ...relative.split("/"));
      mkdirSync(path.dirname(target), { recursive: true });
      const original = resolvePortablePathWithinRoot(root, record.quarantinePath, "legacy file");
      copyFileSync(original, target);
      const copied = readFileSync(target);
      if (
        copied.length !== bytes.length ||
        digest(copied, "md5") !== file.md5 ||
        digest(copied) !== record.sha256
      )
        throw new Error(`${key(source.id, file.relativePath)}: rebound copy verification failed.`);
      records.push({
        sourceId: source.id,
        relativePath: file.relativePath,
        directUrl: file.directUrl,
        bytes: file.bytes,
        md5: file.md5,
        sha256: record.sha256,
        quarantinePath: expectedQuarantinePath(newReviewId, source.id, file.relativePath),
      });
    }
    records.sort((left, right) =>
      key(left.sourceId, left.relativePath).localeCompare(key(right.sourceId, right.relativePath)),
    );
    const review = {
      version: 2,
      reviewId: newReviewId,
      sourceSetSha256: sourceLock.sourceSetSha256,
      files: records,
    };
    writeFileSync(path.join(staging, "review.json"), JSON.stringify(review, null, 2) + "\n", {
      flag: "wx",
    });
    renameSync(staging, destination);
    return { review, reviewPath: path.join(destination, "review.json") };
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

export function parseRebindSourceReviewArguments(argv) {
  const values = argv[0] === "--" ? argv.slice(1) : argv;
  const oldAt = values.indexOf("--legacy-review");
  const newAt = values.indexOf("--review-id");
  const legacyReview = oldAt >= 0 ? values[oldAt + 1] : undefined;
  const reviewId = newAt >= 0 ? values[newAt + 1] : undefined;
  if (!legacyReview || !reviewId || oldAt < 0 || newAt < 0 || values.length !== 4)
    throw new Error(
      "Usage: rebind-source-review.mjs --legacy-review <v1-review.json> --review-id <new-review-id>",
    );
  return { legacyReview, reviewId };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { legacyReview, reviewId } = parseRebindSourceReviewArguments(process.argv.slice(2));
    const reviewPath = resolvePortablePathWithinRoot(projectRoot, legacyReview, "legacy review");
    const quarantine = resolvePortablePathWithinRoot(
      projectRoot,
      QUARANTINE_ROOT,
      "quarantine root",
    );
    assertPathWithinRoot(quarantine, reviewPath, "legacy review");
    if (
      !existsSync(reviewPath) ||
      !lstatSync(reviewPath).isFile() ||
      lstatSync(reviewPath).isSymbolicLink()
    )
      throw new Error("legacy review is missing or unsafe.");
    const result = rebindLegacySourceReview(
      loadRenderingSourceLock(projectRoot),
      JSON.parse(readFileSync(reviewPath, "utf8")),
      { root: projectRoot, reviewId },
    );
    console.log(
      `Rebound ${result.review.files.length} reviewed bytes without network access: ${path.relative(projectRoot, result.reviewPath)}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
