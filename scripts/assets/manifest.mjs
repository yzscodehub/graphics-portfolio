import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const renderingRoot = "public/assets/rendering";
export const manifestRelativePath = `${renderingRoot}/manifest.json`;
export const sourceLockRelativePath = `${renderingRoot}/sources.lock.json`;

const expectedSourceIds = [
  "concrete-road-barrier",
  "fire-hydrant",
  "plastic-crate-02",
  "street-lamp-02",
  "modular-chainlink-fence",
  "concrete-cat-statue",
  "concrete-floor-worn-001",
  "concrete-wall-007",
  "rusty-metal",
  "brick-floor-003",
  "courtyard-hdri-1k",
];
const forbiddenRawExtensions = new Set([".zip", ".blend", ".exr", ".psd", ".tif", ".tiff"]);
const shaPattern = /^[a-f0-9]{64}$/;
const requiredLogicalAssetIds = [
  "calibration-rig",
  "research-courtyard",
  "cornell-scene",
  "neural-heldout-v2",
];
const neuralManifestReferencePath = "public/models/neural-denoiser.manifest.json";
const courtyardRuntimeManifestPath = `${renderingRoot}/manifests/research-courtyard.json`;

function fromRoot(root, relative) {
  return path.resolve(root, relative);
}

function relativePath(root, file) {
  return path.relative(root, file).replaceAll(path.sep, "/");
}

function isWithinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Source-lock paths are authored with POSIX separators but consumed on Windows
 * too. Validate both grammars before resolving, so `..\\`, drive paths, and UNC
 * paths cannot be treated as harmless filenames on the opposite platform.
 */
export function isSafePortableRelativePath(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\0") ||
    value.includes("\\")
  )
    return false;
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || /^[a-zA-Z]:/.test(value))
    return false;
  if (/[<>:"|?*]/.test(value)) return false;
  return value
    .split("/")
    .every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function portableSegments(value) {
  return value.replaceAll("\\", "/").split("/");
}

export function assertPathWithinRoot(root, candidate, label = "path") {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  if (!isWithinRoot(resolvedRoot, resolvedCandidate))
    throw new Error(label + " escaped its allowed root.");
  return resolvedCandidate;
}

export function resolvePortablePathWithinRoot(root, relative, label = "path") {
  if (!isSafePortableRelativePath(relative))
    throw new Error(label + " is not a safe relative path.");
  const candidate = path.resolve(path.resolve(root), ...portableSegments(relative));
  return assertPathWithinRoot(root, candidate, label);
}

export function resolveSourceCachePath(root, rawCache, sourceId, cachePath, label = "cache path") {
  if (!/^[a-z0-9-]+$/.test(sourceId ?? "")) throw new Error(label + " has an unsafe source id.");
  const cacheRoot = resolvePortablePathWithinRoot(root, rawCache, "source cache root");
  const sourceRoot = resolvePortablePathWithinRoot(cacheRoot, sourceId, "source cache directory");
  const target = resolvePortablePathWithinRoot(root, cachePath, label);
  if (target === sourceRoot) throw new Error(label + " must name a source file.");
  return assertPathWithinRoot(sourceRoot, target, label);
}

export function assertExactSourceCachePath(rawCache, sourceId, relativePath, cachePath, label) {
  if (rawCache !== ".cache/rendering-sources")
    throw new Error(label + " must use the configured source cache root.");
  if (!/^[a-z0-9-]+$/.test(sourceId ?? "")) throw new Error(label + " has an unsafe source id.");
  if (!isSafePortableRelativePath(relativePath) || !isSafePortableRelativePath(cachePath))
    throw new Error(label + " is not a safe portable path.");
  const expected = `${rawCache}/${sourceId}/${relativePath}`;
  if (cachePath !== expected)
    throw new Error(label + " must exactly match the source-relative cache path.");
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function readJson(root, relative) {
  return JSON.parse(readFileSync(fromRoot(root, relative), "utf8"));
}

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function add(violations, code, file, value) {
  violations.push({ code, file, value });
}

function validateNeuralManifestReference(root, file, asset, violations) {
  try {
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    const heldout = manifest.heldoutManifest;
    if (
      manifest.version !== 2 ||
      !Array.isArray(manifest.models) ||
      !manifest.models.some((model) => model.id === "rgb") ||
      !heldout?.file ||
      !shaPattern.test(heldout.sha256 ?? "")
    ) {
      add(violations, "rendering-neural-reference", asset.path, "expected neural manifest v2");
      return;
    }
    const heldoutFile = fromRoot(root, `public/models/${heldout.file}`);
    if (
      !existsSync(heldoutFile) ||
      heldout.bytes !== statSync(heldoutFile).size ||
      heldout.sha256 !== sha256(heldoutFile)
    ) {
      add(
        violations,
        "rendering-neural-heldout",
        asset.path,
        "held-out manifest hash/size mismatch",
      );
      return;
    }
    const heldoutManifest = JSON.parse(readFileSync(heldoutFile, "utf8"));
    if (
      heldoutManifest.version !== 2 ||
      !heldoutManifest.files ||
      Object.keys(heldoutManifest.files).length < 5
    )
      add(violations, "rendering-neural-heldout", asset.path, "expected held-out v2 artifact list");
    for (const descriptor of Object.values(heldoutManifest.files ?? {})) {
      const artifactFile = path.join(path.dirname(heldoutFile), descriptor.file ?? "");
      if (
        !existsSync(artifactFile) ||
        descriptor.bytes !== statSync(artifactFile).size ||
        !shaPattern.test(descriptor.sha256 ?? "") ||
        descriptor.sha256 !== sha256(artifactFile)
      )
        add(
          violations,
          "rendering-neural-heldout",
          asset.path,
          "held-out artifact hash/size mismatch",
        );
    }
  } catch (error) {
    add(
      violations,
      "rendering-neural-reference",
      asset.path,
      error instanceof Error ? error.message : "invalid neural manifest",
    );
  }
}

function validateCourtyardRuntimeManifest(root, asset, violations) {
  const file = fromRoot(root, courtyardRuntimeManifestPath);
  try {
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    const record = manifest.assets?.find((entry) => entry.id === asset.id);
    if (
      manifest.version !== 1 ||
      !record ||
      record.path !== asset.path ||
      record.outputSha256 !== asset.outputSha256 ||
      record.bytes !== asset.bytes
    )
      add(
        violations,
        "rendering-courtyard-runtime-manifest",
        courtyardRuntimeManifestPath,
        "record drift",
      );
  } catch (error) {
    add(
      violations,
      "rendering-courtyard-runtime-manifest",
      courtyardRuntimeManifestPath,
      error instanceof Error ? error.message : "missing runtime manifest",
    );
  }
}

export function loadRenderingAssetManifest(root = projectRoot) {
  return readJson(root, manifestRelativePath);
}

export function loadRenderingSourceLock(root = projectRoot) {
  return readJson(root, sourceLockRelativePath);
}

export function validateRenderingAssets(root = projectRoot) {
  const violations = [];
  const assetRoot = fromRoot(root, renderingRoot);
  const manifestFile = fromRoot(root, manifestRelativePath);
  const sourceLockFile = fromRoot(root, sourceLockRelativePath);

  if (!existsSync(manifestFile) || !existsSync(sourceLockFile)) {
    add(
      violations,
      "rendering-asset-manifest",
      manifestRelativePath,
      "manifest and source lock are required",
    );
    return violations;
  }

  let manifest;
  let sourceLock;
  try {
    manifest = loadRenderingAssetManifest(root);
    sourceLock = loadRenderingSourceLock(root);
  } catch (error) {
    add(
      violations,
      "rendering-asset-json",
      renderingRoot,
      error instanceof Error ? error.message : "invalid JSON",
    );
    return violations;
  }

  if (
    manifest.version !== 1 ||
    !["preview-placeholder", "reviewed"].includes(manifest.status) ||
    manifest.sourceLock !== sourceLockRelativePath
  )
    add(
      violations,
      "rendering-asset-contract",
      manifestRelativePath,
      "version/source lock mismatch",
    );
  if (!manifest.budget || !Array.isArray(manifest.assets))
    add(
      violations,
      "rendering-asset-contract",
      manifestRelativePath,
      "budget and assets are required",
    );
  if (sourceLock.version !== 2 || sourceLock.policy?.license !== "CC0")
    add(
      violations,
      "rendering-source-policy",
      sourceLockRelativePath,
      "rendering sources must remain CC0",
    );
  const sourceStage = sourceLock.policy?.stage;
  if (
    (manifest.status === "preview-placeholder" &&
      (sourceLock.policy?.downloaded !== false ||
        !["metadata-locked", "sources-reviewed"].includes(sourceStage))) ||
    (manifest.status === "reviewed" &&
      (sourceLock.policy?.downloaded !== true || sourceStage !== "integrated"))
  )
    add(
      violations,
      "rendering-source-stage",
      sourceLockRelativePath,
      "source download state must match the asset manifest status",
    );

  const defaults = sourceLock.defaults;
  let validRawCache = false;
  if (sourceLock.policy?.rawCache === ".cache/rendering-sources") {
    try {
      resolvePortablePathWithinRoot(root, sourceLock.policy?.rawCache, "source cache root");
      validRawCache = true;
    } catch {
      validRawCache = false;
    }
  }
  if (
    defaults?.license !== "CC0" ||
    !String(defaults.sourceUrl ?? "").startsWith("https://polyhaven.com/a/") ||
    !validRawCache
  )
    add(violations, "rendering-source-defaults", sourceLockRelativePath, "invalid source defaults");
  if (
    manifest.status === "preview-placeholder" &&
    ((sourceStage === "metadata-locked" && defaults.status !== "metadata-locked") ||
      (sourceStage === "sources-reviewed" && defaults.status !== "sources-reviewed"))
  )
    add(
      violations,
      "rendering-source-defaults",
      sourceLockRelativePath,
      "preview source defaults must remain metadata-locked",
    );

  const sourceIds = sourceLock.sources?.map((source) => source.id) ?? [];
  if (
    sourceIds.length !== expectedSourceIds.length ||
    expectedSourceIds.some((id) => !sourceIds.includes(id)) ||
    new Set(sourceIds).size !== sourceIds.length
  )
    add(
      violations,
      "rendering-source-inventory",
      sourceLockRelativePath,
      "six meshes, four textures, and one HDRI are required",
    );
  for (const source of sourceLock.sources ?? []) {
    if (!/^[a-z0-9-]+$/.test(source.id) || !["mesh", "texture", "hdri"].includes(source.kind))
      add(
        violations,
        "rendering-source-entry",
        sourceLockRelativePath,
        `invalid ${source.id ?? "source"}`,
      );
    if (
      !/^[a-z0-9_]+$/.test(source.page ?? "") ||
      !Array.isArray(source.usedBy) ||
      source.usedBy.length === 0
    )
      add(
        violations,
        "rendering-source-entry",
        sourceLockRelativePath,
        `missing page/use ${source.id ?? "source"}`,
      );
    if (!Array.isArray(source.authors) || source.authors.length === 0)
      add(
        violations,
        "rendering-source-authors",
        sourceLockRelativePath,
        `${source.id ?? "source"}: explicit authors are required`,
      );
    if (!Array.isArray(source.files) || source.files.length === 0)
      add(
        violations,
        "rendering-source-review",
        sourceLockRelativePath,
        `${source.id ?? "source"}: selected files are required`,
      );
    if (
      source.license !== "CC0" ||
      !String(source.sourceUrl || "").startsWith("https://polyhaven.com/a/") ||
      !String(source.api?.infoUrl || "").startsWith("https://api.polyhaven.com/info/") ||
      !String(source.api?.filesUrl || "").startsWith("https://api.polyhaven.com/files/") ||
      !/^[a-f0-9]{40}$/i.test(source.api?.filesHash || "") ||
      !Number.isFinite(Date.parse(source.api?.queriedAt || ""))
    )
      add(
        violations,
        "rendering-source-review",
        sourceLockRelativePath,
        `${source.id ?? "source"}: official API provenance is required`,
      );
    const relativePaths = new Set();
    const cachePaths = new Set();
    for (const file of source.files || []) {
      let safeDescriptorPaths;
      try {
        if (!isSafePortableRelativePath(file.relativePath))
          throw new Error("unsafe source relative path");
        resolveSourceCachePath(
          root,
          sourceLock.policy?.rawCache,
          source.id,
          file.cachePath,
          `${source.id || "source"}: cache path`,
        );
        assertExactSourceCachePath(
          sourceLock.policy?.rawCache,
          source.id,
          file.relativePath,
          file.cachePath,
          `${source.id || "source"}: cache path`,
        );
        safeDescriptorPaths = true;
      } catch {
        safeDescriptorPaths = false;
      }
      const validDescriptor =
        typeof file.role === "string" &&
        safeDescriptorPaths &&
        /^https:\/\/dl\.polyhaven\.org\/file\//.test(file.directUrl || "") &&
        Number.isSafeInteger(file.bytes) &&
        file.bytes > 0 &&
        /^[a-f0-9]{32}$/i.test(file.md5 || "");
      if (relativePaths.has(file.relativePath) || cachePaths.has(file.cachePath))
        add(
          violations,
          "rendering-source-file",
          sourceLockRelativePath,
          `${source.id || "source"}: duplicate selected file path`,
        );
      relativePaths.add(file.relativePath);
      cachePaths.add(file.cachePath);
      if (!validDescriptor)
        add(
          violations,
          "rendering-source-file",
          sourceLockRelativePath,
          `${source.id || "source"}: invalid selected file descriptor`,
        );
      const reviewed = sourceStage === "sources-reviewed" || sourceStage === "integrated";
      if (
        (reviewed && (!shaPattern.test(file.sha256 || "") || file.status !== "reviewed")) ||
        (!reviewed && (file.sha256 !== null || file.status !== "metadata-locked"))
      )
        add(
          violations,
          "rendering-source-file-review",
          sourceLockRelativePath,
          `${source.id || "source"}/${file.relativePath || "unknown"}: reviewed SHA-256 state mismatch`,
        );
    }
    const roles = new Set((source.files || []).map((file) => file.role));
    if (
      (source.kind === "mesh" &&
        (source.selection?.format !== "gltf" ||
          source.selection?.resolution !== "1k" ||
          !roles.has("gltf") ||
          !roles.has("gltf-include"))) ||
      (source.kind === "texture" &&
        (source.selection?.format !== "jpg" ||
          source.selection?.resolution !== "1k" ||
          !["base-color", "normal", "roughness"].every((role) => roles.has(role)))) ||
      (source.kind === "hdri" &&
        (source.selection?.format !== "hdr" ||
          source.selection?.resolution !== "1k" ||
          !roles.has("hdr")))
    )
      add(
        violations,
        "rendering-source-selection",
        sourceLockRelativePath,
        `${source.id || "source"}: fixed 1K selection contract mismatch`,
      );
  }

  const totalBytes = (manifest.assets ?? []).reduce(
    (total, asset) => total + (asset.bytes ?? 0),
    0,
  );
  if (totalBytes > manifest.budget?.publicRenderingBytes)
    add(
      violations,
      "rendering-asset-budget",
      manifestRelativePath,
      `total ${totalBytes} exceeds public budget`,
    );
  for (const demoSlug of new Set((manifest.assets ?? []).flatMap((asset) => asset.usedBy ?? []))) {
    const demoBytes = (manifest.assets ?? [])
      .filter((asset) => asset.usedBy?.includes(demoSlug))
      .reduce((total, asset) => total + (asset.bytes ?? 0), 0);
    if (demoBytes > manifest.budget?.demoInitialBytes)
      add(
        violations,
        "rendering-demo-asset-budget",
        manifestRelativePath,
        `${demoSlug}: ${demoBytes} bytes exceeds first-load budget`,
      );
  }
  const heroBytes = (manifest.assets ?? [])
    .filter((asset) => asset.usedBy?.includes("material-lighting"))
    .reduce((total, asset) => total + (asset.bytes ?? 0), 0);
  if (heroBytes > manifest.budget?.heroBytes)
    add(
      violations,
      "rendering-hero-asset-budget",
      manifestRelativePath,
      `${heroBytes} bytes exceeds the Hero asset budget`,
    );
  const renderingFiles = walk(assetRoot);
  const extensionBytes = (extension) =>
    renderingFiles
      .filter((file) => path.extname(file).toLowerCase() === extension)
      .reduce((total, file) => total + statSync(file).size, 0);
  const ktx2Bytes = extensionBytes(".ktx2");
  const webpBytes = extensionBytes(".webp");
  if (ktx2Bytes > manifest.budget?.ktx2Bytes)
    add(
      violations,
      "rendering-ktx2-budget",
      manifestRelativePath,
      `${ktx2Bytes} bytes exceeds the KTX2 budget`,
    );
  if (webpBytes > manifest.budget?.webpFallbackBytes)
    add(
      violations,
      "rendering-webp-budget",
      manifestRelativePath,
      `${webpBytes} bytes exceeds the WebP fallback budget`,
    );
  const assetIds = (manifest.assets ?? []).map((asset) => asset.id);
  if (
    new Set(assetIds).size !== assetIds.length ||
    requiredLogicalAssetIds.some((id) => !assetIds.includes(id))
  )
    add(
      violations,
      "rendering-logical-asset-inventory",
      manifestRelativePath,
      "logical asset IDs are incomplete",
    );
  for (const asset of manifest.assets ?? []) {
    const file = fromRoot(root, asset.path ?? "");
    const isNeuralManifestReference =
      asset.id === "neural-heldout-v2" && asset.path === neuralManifestReferencePath;
    if (
      typeof asset.path !== "string" ||
      (!isNeuralManifestReference &&
        (!asset.path.startsWith(`${renderingRoot}/`) || !isWithinRoot(assetRoot, file)))
    ) {
      add(violations, "rendering-asset-path", manifestRelativePath, asset.id ?? "unknown asset");
      continue;
    }
    if (!existsSync(file)) {
      add(violations, "rendering-asset-missing", asset.path, asset.id ?? "unknown asset");
      continue;
    }
    if (
      !["self-authored", "CC0"].includes(asset.license) ||
      !Array.isArray(asset.authors) ||
      asset.authors.length === 0
    )
      add(violations, "rendering-asset-license", asset.path, asset.id ?? "unknown asset");
    if (
      asset.license === "CC0" &&
      (!/^https:\/\//.test(asset.sourceUrl ?? "") || !shaPattern.test(asset.sourceSha256 ?? ""))
    )
      add(
        violations,
        "rendering-asset-provenance",
        asset.path,
        "CC0 outputs require a source URL and reviewed source SHA-256",
      );
    if (!shaPattern.test(asset.outputSha256 ?? "") || asset.outputSha256 !== sha256(file))
      add(violations, "rendering-asset-hash", asset.path, "SHA-256 mismatch");
    if (asset.bytes !== statSync(file).size)
      add(violations, "rendering-asset-size", asset.path, "byte size mismatch");
    const placeholderAsset = String(asset.role ?? "").includes("placeholder");
    if (
      !Array.isArray(asset.usedBy) ||
      (placeholderAsset
        ? asset.usedBy.length !== 0 ||
          !Array.isArray(asset.plannedFor) ||
          asset.plannedFor.length === 0
        : asset.usedBy.length === 0)
    )
      add(
        violations,
        "rendering-asset-usage",
        asset.path,
        placeholderAsset
          ? "placeholder assets require plannedFor and must not claim runtime use"
          : "at least one runtime Demo is required",
      );
    if (asset.id === "research-courtyard") {
      if (asset.bytes > manifest.budget.courtyardGeometryBytes)
        add(violations, "rendering-courtyard-budget", asset.path, "geometry pack exceeds budget");
      const pack = JSON.parse(readFileSync(file, "utf8"));
      const lods = (pack.meshes ?? []).map((mesh) => mesh.lod);
      if (
        pack.placeholder !== (manifest.status === "preview-placeholder") ||
        pack.coordinateSystem !== "right-handed-y-up-meters" ||
        pack.vertexLayout?.strideBytes !== 32 ||
        pack.indexFormat !== "uint32" ||
        pack.indirectCommand?.alignmentBytes !== 32 ||
        pack.indirectCommand?.firstInstance !== 0 ||
        pack.renderPasses?.alphaMaskForward?.length !== 0 ||
        lods.some(
          (lod) =>
            !(lod.lod0Triangles >= lod.lod1Triangles && lod.lod1Triangles >= lod.lod2Triangles),
        )
      )
        add(violations, "rendering-packed-scene", asset.path, "placeholder contract mismatch");
      validateCourtyardRuntimeManifest(root, asset, violations);
    }
    if (["calibration-rig", "cornell-scene"].includes(asset.id)) {
      try {
        const contract = JSON.parse(readFileSync(file, "utf8"));
        if (
          contract.format !== "graphics-portfolio-scene-contract" ||
          contract.version !== 1 ||
          contract.assetId !== asset.id ||
          contract.externalAssets !== false
        )
          add(violations, "rendering-scene-contract", asset.path, "contract mismatch");
      } catch (error) {
        add(
          violations,
          "rendering-scene-contract",
          asset.path,
          error instanceof Error ? error.message : "invalid scene contract",
        );
      }
    }
    if (asset.id === "neural-heldout-v2")
      validateNeuralManifestReference(root, file, asset, violations);
  }

  for (const file of walk(assetRoot)) {
    const extension = path.extname(file).toLowerCase();
    if (forbiddenRawExtensions.has(extension))
      add(violations, "rendering-forbidden-raw", relativePath(root, file), extension);
  }

  return violations;
}
