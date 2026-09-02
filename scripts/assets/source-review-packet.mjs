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
import sharp from "sharp";
import { renderSourceReviewVisuals } from "./source-review-renderer.mjs";
import {
  calculateSourceSetSha256,
  isSafePortableRelativePath,
  loadRenderingSourceLock,
  projectRoot,
  resolvePortablePathWithinRoot,
  sourceLockRelativePath,
} from "./manifest.mjs";

const QUARANTINE = ".cache/rendering-quarantine";
const PACKET = "review-packet";
const REVIEW_ID = /^[a-z0-9][a-z0-9-]{2,63}$/;
const SHA = /^[a-f0-9]{64}$/;
const MD5 = /^[a-f0-9]{32}$/;
const EXPECTED = { files: 49, mesh: 6, texture: 4, hdri: 1 };
const hash = (bytes, algorithm = "sha256") => createHash(algorithm).update(bytes).digest("hex");
const fail = (message) => {
  throw new Error("Source review packet: " + message);
};
const id = (sourceId, relativePath) => String(sourceId) + "/" + String(relativePath);
const portable = (value) => value.replaceAll(path.sep, "/");
function reviewId(value) {
  if (!REVIEW_ID.test(value ?? "")) fail("review id must be lowercase alphanumeric/hyphen.");
  return value;
}
function directUrl(value, label) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "dl.polyhaven.org" ||
      !url.pathname.startsWith("/file/")
    )
      fail(label + ": direct URL is not an official Poly Haven download.");
  } catch (error) {
    if (String(error.message).startsWith("Source review packet:")) throw error;
    fail(label + ": direct URL is invalid.");
  }
}
function formalInventory(lock) {
  if (lock?.version !== 3) fail("formal source lock must be version 3.");
  if (
    lock.policy?.stage !== "metadata-locked" ||
    lock.policy?.license !== "CC0" ||
    lock.policy?.rawCache !== ".cache/rendering-sources" ||
    !SHA.test(lock.sourceSetSha256 ?? "") ||
    lock.sourceSetSha256 !== calculateSourceSetSha256(lock.sources ?? []) ||
    lock.review !== undefined ||
    lock.integration !== undefined ||
    Object.hasOwn(lock.policy ?? {}, "downloaded") ||
    Object.hasOwn(lock, "defaults")
  )
    fail("formal source lock must be metadata-locked and unpromoted.");
  const kinds = { mesh: 0, texture: 0, hdri: 0 };
  const entries = new Map();
  for (const source of lock.sources ?? []) {
    if (!/^[a-z0-9-]+$/.test(source?.id ?? "") || !Object.hasOwn(kinds, source.kind))
      fail("formal source inventory has an invalid source.");
    kinds[source.kind] += 1;
    if (
      source.license !== "CC0" ||
      !Array.isArray(source.authors) ||
      source.authors.length === 0 ||
      source.authors.some((author) => !String(author).trim())
    )
      fail(source.id + ": CC0 license and explicit authors are required.");
    try {
      const url = new URL(source.sourceUrl);
      if (
        url.protocol !== "https:" ||
        url.hostname !== "polyhaven.com" ||
        !url.pathname.startsWith("/a/")
      )
        fail(source.id + ": source URL is invalid.");
    } catch (error) {
      if (String(error.message).startsWith("Source review packet:")) throw error;
      fail(source.id + ": source URL is invalid.");
    }
    if (!Array.isArray(source.files) || source.files.length === 0)
      fail(source.id + ": selected files are required.");
    for (const file of source.files) {
      const fileId = id(source.id, file?.relativePath);
      if (
        !isSafePortableRelativePath(file?.relativePath) ||
        !isSafePortableRelativePath(file?.cachePath)
      )
        fail(fileId + ": unsafe source or cache path.");
      if (file.cachePath !== ".cache/rendering-sources/" + source.id + "/" + file.relativePath)
        fail(fileId + ": cache path must exactly match source-relative path.");
      if (
        !Number.isSafeInteger(file.bytes) ||
        file.bytes < 1 ||
        !MD5.test(file.md5 ?? "") ||
        file.sha256 !== null ||
        file.status !== "metadata-locked"
      )
        fail(fileId + ": invalid metadata-locked descriptor.");
      directUrl(file.directUrl, fileId);
      if (entries.has(fileId)) fail(fileId + ": duplicate source descriptor.");
      entries.set(fileId, { source, file, fileId });
    }
  }
  if (entries.size !== EXPECTED.files)
    fail("formal source inventory must contain exactly 49 files.");
  for (const kind of ["mesh", "texture", "hdri"])
    if (kinds[kind] !== EXPECTED[kind])
      fail("formal source inventory has the wrong " + kind + " count.");
  return entries;
}
function verifiedInventory(root, lock, review) {
  const idValue = reviewId(review?.reviewId);
  if (review?.version !== 2 || !Array.isArray(review.files))
    fail("review.json contract is invalid.");
  const lockHash = hash(Buffer.from(JSON.stringify(lock)));
  if (review.sourceSetSha256 !== lock.sourceSetSha256)
    fail("review.json is not bound to the formal source set.");
  const expected = formalInventory(lock);
  if (review.files.length !== EXPECTED.files)
    fail("review inventory must contain exactly 49 files.");
  const records = new Map();
  for (const record of review.files) {
    const fileId = id(record?.sourceId, record?.relativePath);
    if (records.has(fileId)) fail(fileId + ": duplicate review record.");
    records.set(fileId, record);
  }
  const verified = [];
  for (const { source, file, fileId } of expected.values()) {
    const record = records.get(fileId);
    if (!record) fail(fileId + ": missing review record.");
    if (
      record.directUrl !== file.directUrl ||
      record.bytes !== file.bytes ||
      record.md5 !== file.md5 ||
      !SHA.test(record.sha256 ?? "")
    )
      fail(fileId + ": review metadata drifted from formal source lock.");
    const quarantinePath = QUARANTINE + "/" + idValue + "/" + source.id + "/" + file.relativePath;
    if (record.quarantinePath !== quarantinePath)
      fail(fileId + ": quarantine path is not canonical.");
    const absolute = resolvePortablePathWithinRoot(
      root,
      quarantinePath,
      fileId + " quarantine path",
    );
    if (
      !existsSync(absolute) ||
      !lstatSync(absolute).isFile() ||
      lstatSync(absolute).isSymbolicLink()
    )
      fail(fileId + ": quarantined file is missing or unsafe.");
    if (statSync(absolute).size !== file.bytes) fail(fileId + ": byte-size mismatch.");
    const bytes = readFileSync(absolute);
    if (hash(bytes, "md5") !== file.md5) fail(fileId + ": MD5 mismatch.");
    if (hash(bytes) !== record.sha256) fail(fileId + ": SHA-256 mismatch.");
    verified.push({
      id: fileId,
      sourceId: source.id,
      sourceKind: source.kind,
      source,
      role: file.role,
      relativePath: file.relativePath,
      directUrl: file.directUrl,
      bytes: file.bytes,
      md5: file.md5,
      sha256: record.sha256,
      quarantinePath,
      absolute,
    });
  }
  for (const fileId of records.keys())
    if (!expected.has(fileId)) fail(fileId + ": unexpected review record.");
  return {
    reviewId: idValue,
    lockHash,
    sourceSetSha256: lock.sourceSetSha256,
    records: verified.sort((a, b) => a.id.localeCompare(b.id)),
  };
}
function reviewedUri(uri, label, sourceId, gltfPath, records) {
  if (
    typeof uri !== "string" ||
    uri.length === 0 ||
    uri.startsWith("data:") ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(uri) ||
    path.posix.isAbsolute(uri) ||
    path.win32.isAbsolute(uri) ||
    !isSafePortableRelativePath(uri)
  )
    fail(label + ": data, remote, absolute, and escaped URIs are rejected.");
  const parent = path.posix.dirname(gltfPath);
  const relativePath = path.posix.join(parent === "." ? "" : parent, uri);
  if (!isSafePortableRelativePath(relativePath)) fail(label + ": URI escaped its source root.");
  const record = records.get(id(sourceId, relativePath));
  if (!record) fail(label + ": URI is not in the same source's reviewed inventory.");
  return { relativePath, bytes: record.bytes, sha256: record.sha256 };
}
export function validateReviewedGltf(record, records) {
  let gltf;
  try {
    gltf = JSON.parse(readFileSync(record.absolute, "utf8"));
  } catch {
    fail(record.id + ": invalid glTF JSON.");
  }
  if (!String(gltf?.asset?.version ?? "").startsWith("2."))
    fail(record.id + ": glTF 2.x asset metadata is required.");
  if (!Array.isArray(gltf.buffers) || gltf.buffers.length === 0)
    fail(record.id + ": buffers are required.");
  const references = gltf.buffers.map((buffer, index) => {
    if (!Number.isSafeInteger(buffer?.byteLength) || buffer.byteLength < 1)
      fail(record.id + ": invalid buffer byteLength.");
    return reviewedUri(
      buffer.uri,
      record.id + ": buffers[" + index + "]",
      record.sourceId,
      record.relativePath,
      records,
    );
  });
  for (const [index, image] of (gltf.images ?? []).entries()) {
    if (image?.uri !== undefined)
      references.push(
        reviewedUri(
          image.uri,
          record.id + ": images[" + index + "]",
          record.sourceId,
          record.relativePath,
          records,
        ),
      );
    else if (
      !Number.isSafeInteger(image?.bufferView) ||
      image.bufferView < 0 ||
      image.bufferView >= (gltf.bufferViews?.length ?? 0)
    )
      fail(record.id + ": images[" + index + "] has no reviewed URI or valid bufferView.");
  }
  return {
    sourceId: record.sourceId,
    gltf: { path: record.quarantinePath, bytes: record.bytes, sha256: record.sha256 },
    references,
    meshes: gltf.meshes?.length ?? 0,
    materials: gltf.materials?.length ?? 0,
    scenes: gltf.scenes?.length ?? 0,
  };
}
async function decodeJpeg(record) {
  try {
    const metadata = await sharp(record.absolute, {
      failOn: "error",
      limitInputPixels: 16_777_216,
    }).metadata();
    const raw = await sharp(record.absolute, { failOn: "error", limitInputPixels: 16_777_216 })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (
      metadata.format !== "jpeg" ||
      !metadata.width ||
      !metadata.height ||
      raw.info.width !== metadata.width ||
      raw.info.height !== metadata.height ||
      raw.data.length !== metadata.width * metadata.height * 4
    )
      fail(record.id + ": JPEG did not fully decode.");
    return {
      sourceId: record.sourceId,
      relativePath: record.relativePath,
      width: metadata.width,
      height: metadata.height,
      channels: raw.info.channels,
      decodedBytes: raw.data.length,
    };
  } catch (error) {
    if (String(error.message).startsWith("Source review packet:")) throw error;
    fail(
      record.id +
        ": JPEG full decode failed (" +
        (error instanceof Error ? error.message : "unknown error") +
        ").",
    );
  }
}
function decodeHdrHeader(record) {
  const bytes = readFileSync(record.absolute);
  const headerEnd = bytes.indexOf(Buffer.from("\n\n"));
  if (headerEnd < 0) fail(record.id + ": Radiance HDR header terminator is missing.");
  const header = bytes.subarray(0, headerEnd).toString("ascii").replaceAll("\r", "");
  if (
    !/^#\?(RADIANCE|RGBE)$/.test(header.split("\n")[0] ?? "") ||
    !header.includes("FORMAT=32-bit_rle_rgbe")
  )
    fail(record.id + ": unsupported Radiance HDR header.");
  const tail = bytes.subarray(headerEnd + 2);
  const newline = tail.indexOf(0x0a);
  const match = /^([+-])Y\s+(\d+)\s+([+-])X\s+(\d+)$/.exec(
    tail.subarray(0, newline).toString("ascii").replace("\r", "").trim(),
  );
  const width = Number(match?.[4]),
    height = Number(match?.[2]),
    payloadBytes = tail.length - newline - 1;
  if (
    !match ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    payloadBytes < 4
  )
    fail(record.id + ": invalid Radiance HDR dimensions or payload.");
  return { sourceId: record.sourceId, width, height, payloadBytes };
}
function describe(root, file) {
  return {
    path: portable(path.relative(root, file)),
    bytes: statSync(file).size,
    sha256: hash(readFileSync(file)),
  };
}
function pngDimensions(file) {
  const bytes = readFileSync(file);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}
function verifyVisualReceipt(stage, visual, label) {
  if (
    !visual ||
    !isSafePortableRelativePath(visual.path ?? "") ||
    !Number.isSafeInteger(visual.bytes) ||
    visual.bytes < 128 ||
    !SHA.test(visual.sha256 ?? "") ||
    typeof visual.renderer !== "string" ||
    !visual.renderer.trim() ||
    !Number.isSafeInteger(visual.width) ||
    visual.width < 1 ||
    !Number.isSafeInteger(visual.height) ||
    visual.height < 1
  )
    return false;
  const output = resolvePortablePathWithinRoot(stage, visual.path, label);
  const dimensions = existsSync(output) ? pngDimensions(output) : null;
  return (
    existsSync(output) &&
    lstatSync(output).isFile() &&
    !lstatSync(output).isSymbolicLink() &&
    statSync(output).size === visual.bytes &&
    hash(readFileSync(output)) === visual.sha256 &&
    dimensions?.width === visual.width &&
    dimensions?.height === visual.height
  );
}
async function materialThumbs(records, stage) {
  const visualRoot = path.join(stage, "visuals");
  mkdirSync(visualRoot, { recursive: true });
  const materials = [];
  const sources = [
    ...new Set(
      records.filter((record) => record.sourceKind === "texture").map((record) => record.sourceId),
    ),
  ].sort();
  for (const sourceId of sources) {
    const maps = ["base-color", "normal", "roughness"].map((role) => {
      const record = records.find(
        (candidate) => candidate.sourceId === sourceId && candidate.role === role,
      );
      if (!record) fail(sourceId + ": " + role + " JPEG is required for a review thumbnail.");
      return record;
    });
    const output = path.join(visualRoot, "material-" + sourceId + ".jpg");
    const panels = await Promise.all(
      maps.map((record) =>
        sharp(record.absolute, { failOn: "error" })
          .resize(320, 220, { fit: "cover" })
          .jpeg({ quality: 86, mozjpeg: true })
          .toBuffer(),
      ),
    );
    await sharp({ create: { width: 960, height: 220, channels: 3, background: "#111918" } })
      .composite(panels.map((input, index) => ({ input, left: index * 320, top: 0 })))
      .jpeg({ quality: 86, mozjpeg: true })
      .toFile(output);
    materials.push({
      sourceId,
      roles: maps.map((record) => record.role),
      ...describe(stage, output),
    });
  }
  const hdr = records.find((record) => record.sourceKind === "hdri" && record.role === "hdr");
  if (!hdr) fail("HDRI source is missing.");
  return { materials, hdr: decodeHdrHeader(hdr) };
}
function sourceSummary(records) {
  const grouped = new Map();
  for (const record of records) {
    if (!grouped.has(record.sourceId))
      grouped.set(record.sourceId, {
        id: record.sourceId,
        kind: record.sourceKind,
        sourceUrl: record.source.sourceUrl,
        license: record.source.license,
        authors: [...record.source.authors],
        files: [],
      });
    const file = { ...record };
    delete file.absolute;
    delete file.source;
    grouped.get(record.sourceId).files.push(file);
  }
  return [...grouped.values()].sort((a, b) => a.id.localeCompare(b.id));
}
function markdown(packet) {
  const table = packet.sources
    .map(
      (source) =>
        "| " +
        source.id +
        " | " +
        source.kind +
        " | " +
        source.authors.join(", ") +
        " | " +
        source.files.length +
        " | [Poly Haven](" +
        source.sourceUrl +
        ") |",
    )
    .join("\n");
  const models = packet.visuals.models
    .map((model) => "- " + model.sourceId + ": ![" + model.sourceId + "](" + model.path + ")")
    .join("\n");
  const materials = packet.visuals.materials
    .map(
      (material) =>
        "- " +
        material.sourceId +
        " (" +
        material.roles.join(", ") +
        "): ![" +
        material.sourceId +
        "](" +
        material.path +
        ")",
    )
    .join("\n");
  return (
    "# Research Courtyard source review packet\n\n" +
    "Status: **VALIDATED - AWAITING HUMAN APPROVAL**\n\n" +
    "- Formal files: " +
    packet.inventory.expectedFiles +
    "\n" +
    "- Quarantine byte/MD5/SHA-256 checks: " +
    packet.inventory.verifiedFiles +
    "\n" +
    "- glTF documents: " +
    packet.gltf.length +
    "\n" +
    "- Full JPEG decodes: " +
    packet.jpeg.length +
    "\n" +
    "- Radiance HDR dimensions: " +
    packet.hdr.width +
    " x " +
    packet.hdr.height +
    "\n\n" +
    "## Sources\n\n| Source | Kind | Authors | Files | Origin |\n| --- | --- | --- | ---: | --- |\n" +
    table +
    "\n\n## Model views\n\n" +
    models +
    "\n\n## Material map strips\n\n" +
    materials +
    "\n\n## Environment\n\n![" +
    packet.visuals.hdri.sourceId +
    "](" +
    packet.visuals.hdri.path +
    ")\n" +
    "\n\nThis packet is local-only and does not promote source files or public assets. Human approval remains mandatory before any apply operation.\n"
  );
}
export async function generateSourceReviewPacket(options = {}) {
  const root = path.resolve(options.root ?? projectRoot);
  const lock = options.sourceLock ?? loadRenderingSourceLock(root);
  const checked = verifiedInventory(root, lock, options.review);
  const reviewRoot = resolvePortablePathWithinRoot(
    root,
    QUARANTINE + "/" + checked.reviewId,
    "review root",
  );
  const output = path.join(reviewRoot, PACKET);
  if (existsSync(output))
    fail("review packet already exists; retain it for the human review record.");
  const stage = path.join(reviewRoot, "." + PACKET + ".tmp-" + process.pid + "-" + Date.now());
  try {
    mkdirSync(stage, { recursive: false });
    if (!lstatSync(stage).isDirectory() || lstatSync(stage).isSymbolicLink())
      fail("review packet staging path is not a newly created regular directory.");
    const records = new Map(checked.records.map((record) => [record.id, record]));
    const gltf = checked.records
      .filter((record) => record.sourceKind === "mesh" && record.role === "gltf")
      .map((record) => validateReviewedGltf(record, records));
    if (gltf.length !== EXPECTED.mesh) fail("exactly six mesh glTF documents are required.");
    const jpeg = [];
    for (const record of checked.records.filter(
      (record) => path.extname(record.relativePath).toLowerCase() === ".jpg",
    ))
      jpeg.push(await decodeJpeg(record));
    const visual = await materialThumbs(checked.records, stage);
    const renderVisuals = options.renderVisuals ?? renderSourceReviewVisuals;
    const rendered = await renderVisuals({
      root,
      reviewId: checked.reviewId,
      stage,
      records: checked.records,
      models: gltf,
    });
    const models = rendered.models;
    if (!Array.isArray(models) || models.length !== EXPECTED.mesh)
      fail("authentic renderer did not produce all six model review views.");
    for (const model of models) {
      if (
        !gltf.some((entry) => entry.sourceId === model.sourceId) ||
        !verifyVisualReceipt(stage, model, "model review view")
      )
        fail("model review view is missing or not bound to a reviewed glTF.");
    }
    const hdri = rendered.hdr;
    if (
      !hdri ||
      hdri.sourceId !== visual.hdr.sourceId ||
      !verifyVisualReceipt(stage, hdri, "HDRI review view")
    )
      fail("HDRI review view is missing or does not match its recorded receipt.");
    const packet = {
      version: 1,
      kind: "graphics-portfolio-source-review-packet",
      generatedAt: new Date().toISOString(),
      review: {
        reviewId: checked.reviewId,
        reviewPath: QUARANTINE + "/" + checked.reviewId + "/review.json",
        sourceSetSha256: checked.sourceSetSha256,
      },
      formalSourceLock: {
        path: options.sourceLockPath ?? sourceLockRelativePath,
        version: lock.version,
        sha256: checked.lockHash,
        sourceSetSha256: checked.sourceSetSha256,
        stage: lock.policy.stage,
      },
      inventory: {
        expectedFiles: EXPECTED.files,
        reviewedFiles: checked.records.length,
        verifiedFiles: checked.records.length,
        sourceCounts: { mesh: EXPECTED.mesh, texture: EXPECTED.texture, hdri: EXPECTED.hdri },
      },
      sources: sourceSummary(checked.records),
      gltf,
      jpeg,
      hdr: visual.hdr,
      visuals: { models, materials: visual.materials, hdri },
      renderer: rendered.diagnostics,
      approval: {
        state: "awaiting-human-approval",
        appliesSources: false,
        appliesPublicAssets: false,
      },
    };
    writeFileSync(path.join(stage, "machine.json"), JSON.stringify(packet, null, 2) + "\n");
    writeFileSync(path.join(stage, "README.md"), markdown(packet));
    renameSync(stage, output);
    return { output, packet };
  } catch (error) {
    rmSync(stage, { recursive: true, force: true });
    throw error;
  }
}
export function parseSourceReviewPacketArguments(argv) {
  const values = argv[0] === "--" ? argv.slice(1) : argv;
  const reviewAt = values.indexOf("--review"),
    lockAt = values.indexOf("--source-lock");
  const reviewPath = reviewAt >= 0 ? values[reviewAt + 1] : undefined;
  const sourceLockPath = lockAt >= 0 ? values[lockAt + 1] : sourceLockRelativePath;
  const known = new Set([reviewAt, reviewAt + 1]);
  if (lockAt >= 0) {
    known.add(lockAt);
    known.add(lockAt + 1);
  }
  if (!reviewPath || !sourceLockPath || values.some((_, index) => !known.has(index)))
    fail(
      "usage: source-review-packet.mjs --review .cache/rendering-quarantine/<review-id>/review.json [--source-lock public/assets/rendering/sources.lock.json]",
    );
  return { reviewPath, sourceLockPath };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseSourceReviewPacketArguments(process.argv.slice(2));
    const review = JSON.parse(
      readFileSync(
        resolvePortablePathWithinRoot(projectRoot, args.reviewPath, "review file"),
        "utf8",
      ),
    );
    if (args.reviewPath !== QUARANTINE + "/" + reviewId(review.reviewId) + "/review.json")
      fail("review path must be the canonical quarantine review.json.");
    const sourceLock = JSON.parse(
      readFileSync(
        resolvePortablePathWithinRoot(projectRoot, args.sourceLockPath, "formal source lock"),
        "utf8",
      ),
    );
    const result = await generateSourceReviewPacket({
      root: projectRoot,
      review,
      sourceLock,
      sourceLockPath: args.sourceLockPath,
    });
    console.log(
      "Wrote local review packet: " + portable(path.relative(projectRoot, result.output)),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
