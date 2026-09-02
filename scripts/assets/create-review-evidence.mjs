import { createHash, randomUUID } from "node:crypto";
import {
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
  calculateSourceSetSha256,
  loadRenderingSourceLock,
  projectRoot,
  resolvePortablePathWithinRoot,
} from "./manifest.mjs";
import { reviewEvidencePath } from "./approve-source-review.mjs";

const QUARANTINE_ROOT = ".cache/rendering-quarantine";
const reviewIdPattern = /^[a-z0-9][a-z0-9-]{2,63}$/;

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function requireMetadataLocked(sourceLock) {
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
    throw new Error("review evidence can only be created from an unpromoted v3 metadata lock.");
}

function safeReviewId(value) {
  if (!reviewIdPattern.test(value ?? ""))
    throw new Error("review id must be lowercase alphanumeric/hyphen.");
  return value;
}

function regularFile(file, label) {
  if (!existsSync(file) || !lstatSync(file).isFile() || lstatSync(file).isSymbolicLink())
    throw new Error(`${label} is missing or unsafe.`);
}

export function createReviewEvidenceDescriptor(sourceLock, options = {}) {
  requireMetadataLocked(sourceLock);
  const root = options.root || projectRoot;
  const reviewId = safeReviewId(options.reviewId);
  const reviewer = String(options.reviewer ?? "").trim();
  const reviewedAt = String(options.reviewedAt ?? "");
  if (!reviewer || !Number.isFinite(Date.parse(reviewedAt)))
    throw new Error("reviewer and an ISO reviewed-at timestamp are required.");
  const reviewPath = resolvePortablePathWithinRoot(
    root,
    `${QUARANTINE_ROOT}/${reviewId}/review.json`,
    "review receipt",
  );
  regularFile(reviewPath, "review receipt");
  const review = JSON.parse(readFileSync(reviewPath, "utf8"));
  if (
    review?.version !== 2 ||
    review.reviewId !== reviewId ||
    review.sourceSetSha256 !== sourceLock.sourceSetSha256 ||
    !Array.isArray(review.files)
  )
    throw new Error("review receipt is not bound to this source set.");
  const packetRelative = `${QUARANTINE_ROOT}/${reviewId}/review-packet/machine.json`;
  const packetPath = resolvePortablePathWithinRoot(root, packetRelative, "review packet receipt");
  regularFile(packetPath, "review packet receipt");
  const packetBytes = readFileSync(packetPath);
  const packet = JSON.parse(packetBytes.toString("utf8"));
  if (
    packet?.version !== 1 ||
    packet?.kind !== "graphics-portfolio-source-review-packet" ||
    packet?.review?.reviewId !== reviewId ||
    packet?.review?.sourceSetSha256 !== sourceLock.sourceSetSha256 ||
    packet?.approval?.state !== "awaiting-human-approval"
  )
    throw new Error("review packet is not an awaiting-human-approval receipt for this source set.");
  const relative = reviewEvidencePath(reviewId);
  const output = resolvePortablePathWithinRoot(root, relative, "review evidence descriptor");
  if (existsSync(output))
    throw new Error("review evidence descriptor already exists; do not overwrite it.");
  const descriptor = {
    version: 1,
    reviewId,
    sourceSetSha256: sourceLock.sourceSetSha256,
    reviewer,
    reviewedAt,
    packet: { path: packetRelative, sha256: digest(packetBytes) },
  };
  mkdirSync(path.dirname(output), { recursive: true });
  const staging = `${output}.tmp-${randomUUID()}`;
  try {
    writeFileSync(staging, JSON.stringify(descriptor, null, 2) + "\n", { flag: "wx" });
    renameSync(staging, output);
  } finally {
    if (existsSync(staging)) rmSync(staging, { force: true });
  }
  return { descriptor, output };
}

export function parseCreateReviewEvidenceArguments(argv) {
  const values = argv[0] === "--" ? argv.slice(1) : argv;
  const field = (name) => {
    const at = values.indexOf(name);
    return at >= 0 ? values[at + 1] : undefined;
  };
  const reviewId = field("--review-id");
  const reviewer = field("--reviewer");
  const reviewedAt = field("--reviewed-at");
  if (!reviewId || !reviewer || !reviewedAt || values.length !== 6)
    throw new Error(
      "Usage: create-review-evidence.mjs --review-id <id> --reviewer <human-reviewer> --reviewed-at <ISO-8601>",
    );
  return { reviewId, reviewer, reviewedAt };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseCreateReviewEvidenceArguments(process.argv.slice(2));
    const result = createReviewEvidenceDescriptor(loadRenderingSourceLock(projectRoot), {
      root: projectRoot,
      ...options,
    });
    console.log(
      `Wrote review evidence descriptor for human staging: ${path.relative(projectRoot, result.output)}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
