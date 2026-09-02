import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
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

const REVIEW_ROOT = ".cache/rendering-quarantine";
const PUBLIC_EVIDENCE_ROOT = "public/assets/rendering/reviews";
const reviewIdPattern = /^[a-z0-9][a-z0-9-]{2,63}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;

function digest(bytes, algorithm = "sha256") {
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
    sourceLock?.version !== 3 ||
    sourceLock?.policy?.stage !== "metadata-locked" ||
    sourceLock.policy?.license !== "CC0" ||
    sourceLock.policy?.rawCache !== ".cache/rendering-sources" ||
    sourceLock.sourceSetSha256 !== calculateSourceSetSha256(sourceLock.sources) ||
    sourceLock.review !== undefined ||
    sourceLock.integration !== undefined ||
    Object.hasOwn(sourceLock.policy ?? {}, "downloaded") ||
    Object.hasOwn(sourceLock, "defaults")
  )
    throw new Error(
      operation +
        " requires a v3 metadata-locked source lock; reviewed or integrated locks are immutable.",
    );
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

export function reviewEvidencePath(reviewId) {
  return `${PUBLIC_EVIDENCE_ROOT}/${safeReviewId(reviewId)}.json`;
}

function expectedPacketPath(reviewId) {
  return `${REVIEW_ROOT}/${safeReviewId(reviewId)}/review-packet/machine.json`;
}

export function validateReviewEvidenceDescriptor(sourceLock, review, options = {}) {
  const root = options.root || projectRoot;
  const id = safeReviewId(review?.reviewId);
  const relative = options.evidencePath || reviewEvidencePath(id);
  if (relative !== reviewEvidencePath(id))
    throw new Error("review evidence descriptor must use its canonical public path.");
  const evidenceFile = resolvePortablePathWithinRoot(root, relative, "review evidence descriptor");
  const evidenceRoot = resolvePortablePathWithinRoot(
    root,
    PUBLIC_EVIDENCE_ROOT,
    "review evidence root",
  );
  assertPathWithinRoot(evidenceRoot, evidenceFile, "review evidence descriptor");
  if (
    !existsSync(evidenceFile) ||
    !lstatSync(evidenceFile).isFile() ||
    lstatSync(evidenceFile).isSymbolicLink()
  )
    throw new Error("review evidence descriptor is missing.");

  const bytes = readFileSync(evidenceFile);
  let descriptor;
  try {
    descriptor = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("review evidence descriptor is not valid JSON.");
  }
  const packet = descriptor?.packet;
  if (
    descriptor?.version !== 1 ||
    descriptor?.reviewId !== id ||
    descriptor?.sourceSetSha256 !== sourceLock.sourceSetSha256 ||
    typeof descriptor?.reviewer !== "string" ||
    descriptor.reviewer.trim().length === 0 ||
    descriptor.reviewer !== descriptor.reviewer.trim() ||
    !Number.isFinite(Date.parse(descriptor?.reviewedAt ?? "")) ||
    !packet ||
    packet.path !== expectedPacketPath(id) ||
    !sha256Pattern.test(packet.sha256 ?? "")
  )
    throw new Error("review evidence descriptor does not bind this source set and packet.");
  const packetFile = resolvePortablePathWithinRoot(root, packet.path, "review packet receipt");
  const reviewRoot = resolvePortablePathWithinRoot(root, `${REVIEW_ROOT}/${id}`, "review root");
  assertPathWithinRoot(reviewRoot, packetFile, "review packet receipt");
  if (
    !existsSync(packetFile) ||
    !lstatSync(packetFile).isFile() ||
    lstatSync(packetFile).isSymbolicLink()
  )
    throw new Error("review packet receipt is missing.");
  if (digest(readFileSync(packetFile)) !== packet.sha256)
    throw new Error("review packet receipt SHA-256 mismatch.");
  return {
    reviewId: id,
    reviewer: descriptor.reviewer.trim(),
    reviewedAt: descriptor.reviewedAt,
    evidencePath: relative,
    evidenceSha256: digest(bytes),
  };
}

export function approveSourceReview(sourceLock, review, options = {}) {
  requireMetadataLocked(sourceLock, "source review approval");
  const root = options.root || projectRoot;
  const reviewId = safeReviewId(review?.reviewId);
  if (review?.version !== 2 || !Array.isArray(review.files))
    throw new Error("candidate review contract is invalid.");
  if (review.sourceSetSha256 !== sourceLock.sourceSetSha256)
    throw new Error("candidate review was not generated from the current source set.");

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
      sourceLock.policy.rawCache,
      source.id,
      file.cachePath,
      id + ": cache path",
    );
    assertExactSourceCachePath(
      sourceLock.policy.rawCache,
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
    if (
      !existsSync(candidate) ||
      !lstatSync(candidate).isFile() ||
      lstatSync(candidate).isSymbolicLink() ||
      statSync(candidate).size !== file.bytes
    )
      throw new Error(id + ": quarantine file is missing or has the wrong size.");
    const bytes = readFileSync(candidate);
    if (digest(bytes, "md5") !== file.md5) throw new Error(id + ": quarantine MD5 mismatch.");
    const sha256 = digest(bytes);
    if (sha256 !== record.sha256 || !sha256Pattern.test(sha256))
      throw new Error(id + ": quarantine SHA-256 mismatch.");
    approvedHashes.set(id, sha256);
  }

  const evidence = validateReviewEvidenceDescriptor(sourceLock, review, {
    root,
    evidencePath: options.evidencePath,
  });
  const approved = globalThis.structuredClone(sourceLock);
  approved.policy = { ...approved.policy, stage: "sources-reviewed" };
  approved.review = evidence;
  for (const source of approved.sources)
    for (const file of source.files) {
      file.sha256 = approvedHashes.get(key(source.id, file.relativePath));
      file.status = "reviewed";
    }
  return approved;
}

export function writeApprovedSourceReview(sourceLock, review, options = {}) {
  const root = options.root || projectRoot;
  const approved = approveSourceReview(sourceLock, review, {
    root,
    evidencePath: options.evidencePath,
  });
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
  writeJsonAtomically(output, JSON.stringify(approved, null, 2) + "\n", options.apply);
  return { approved, output };
}

function writeJsonAtomically(output, serialized, replaceExisting) {
  const temporary = `${output}.tmp-${process.pid}-${Date.now()}`;
  const backup = `${output}.backup-${process.pid}-${Date.now()}`;
  let movedPrevious = false;
  try {
    writeFileSync(temporary, serialized, { flag: "wx" });
    if (replaceExisting && existsSync(output)) {
      renameSync(output, backup);
      movedPrevious = true;
    }
    renameSync(temporary, output);
    if (movedPrevious) rmSync(backup, { force: true });
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
    if (!existsSync(output) && movedPrevious && existsSync(backup)) renameSync(backup, output);
  }
}

function cliArguments(argv) {
  if (argv[0] === "--") argv = argv.slice(1);
  const reviewIndex = argv.indexOf("--review");
  const evidenceIndex = argv.indexOf("--evidence");
  const reviewFile = reviewIndex >= 0 ? argv[reviewIndex + 1] : undefined;
  const evidencePath = evidenceIndex >= 0 ? argv[evidenceIndex + 1] : undefined;
  const apply = argv.includes("--apply");
  const expectedLength = apply ? 5 : 4;
  if (
    !reviewFile ||
    !evidencePath ||
    reviewIndex < 0 ||
    evidenceIndex < 0 ||
    argv.length !== expectedLength
  )
    throw new Error(
      "Usage: approve-source-review.mjs --review <review.json> --evidence <public-review.json> [--apply]",
    );
  return { reviewFile, evidencePath, apply };
}

export { cliArguments as parseApproveSourceReviewArguments };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { reviewFile, evidencePath, apply } = cliArguments(process.argv.slice(2));
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
    if (
      !existsSync(approvedReviewPath) ||
      !lstatSync(approvedReviewPath).isFile() ||
      lstatSync(approvedReviewPath).isSymbolicLink()
    )
      throw new Error("review file is missing or unsafe.");
    const review = JSON.parse(readFileSync(approvedReviewPath, "utf8"));
    const sourceLock = loadRenderingSourceLock(projectRoot);
    const result = writeApprovedSourceReview(sourceLock, review, {
      root: projectRoot,
      evidencePath,
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
