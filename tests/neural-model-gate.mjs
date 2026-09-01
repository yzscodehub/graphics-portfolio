import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

function hash(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function artifactIsBound(root, entry) {
  if (!entry || typeof entry.file !== "string" || !Number.isSafeInteger(entry.bytes)) return false;
  const file = path.join(root, entry.file);
  return (
    existsSync(file) &&
    entry.bytes > 0 &&
    statSync(file).size === entry.bytes &&
    /^[a-f0-9]{64}$/i.test(entry.sha256 || "") &&
    hash(file) === entry.sha256
  );
}

const reviewedDatasetManifestSha256 =
  "7b6eacc3eb5f32ed9e1ae14d76a1ffdf4fb426b7ac5fffeb025cac177fc7dd4c";

function hasReviewedHeldoutSemantics(heldout) {
  const exported = heldout?.export;
  return (
    heldout?.renderer === "procedural-cornell-mc-v1" &&
    heldout?.split === "val" &&
    heldout?.stem === "scene-0001" &&
    heldout?.sceneSeed === 91_103 &&
    JSON.stringify(heldout?.shape) === JSON.stringify([1, 3, 256, 256]) &&
    heldout?.dtype === "float16-le" &&
    heldout?.layout === "NCHW" &&
    heldout?.noisySamplesPerPixel === 1 &&
    heldout?.referenceSamplesPerPixel === 64 &&
    exported?.version === "reviewed-web-pair-v2" &&
    exported?.assetStem === "scene-0001" &&
    exported?.sourceDatasetStem === "scene-0064" &&
    exported?.datasetManifestSha256 === reviewedDatasetManifestSha256
  );
}

export function validateNeuralModelV2Artifacts(projectRoot, violations, requireGuidedReview) {
  const modelRoot = path.join(projectRoot, "public", "models");
  const manifestPath = path.join(modelRoot, "neural-denoiser.manifest.json");
  const fail = (code, file, value) => violations.push({ code, file, line: 0, value });
  if (!existsSync(manifestPath)) {
    fail("missing-model-manifest", "public/models/neural-denoiser.manifest.json", "required");
    return;
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    fail(
      "model-manifest-json",
      "public/models/neural-denoiser.manifest.json",
      "valid JSON required",
    );
    return;
  }
  const rgb = manifest?.models?.find((entry) => entry?.id === "rgb");
  const guided = manifest?.models?.find((entry) => entry?.id === "guided");
  if (
    manifest?.version !== 2 ||
    !Array.isArray(manifest?.models) ||
    manifest.models.length !== 2 ||
    !artifactIsBound(modelRoot, manifest?.heldoutManifest) ||
    !artifactIsBound(modelRoot, rgb) ||
    !artifactIsBound(modelRoot, guided?.candidateOutput) ||
    rgb?.status !== "reviewed" ||
    rgb?.kind !== "onnx" ||
    rgb?.input?.name !== "noisy_rgb" ||
    JSON.stringify(rgb?.input?.shape) !== JSON.stringify([1, 3, 256, 256]) ||
    guided?.kind !== "static-candidate" ||
    guided?.status !== "candidate" ||
    guided?.input?.name !== "noisy_albedo_world_normal" ||
    JSON.stringify(guided?.input?.shape) !== JSON.stringify([1, 9, 256, 256])
  ) {
    fail(
      "model-manifest-v2-contract",
      "public/models/neural-denoiser.manifest.json",
      "reviewed RGB and candidate guided contracts required",
    );
    return;
  }

  const heldoutPath = path.join(modelRoot, manifest.heldoutManifest.file);
  try {
    const heldout = JSON.parse(readFileSync(heldoutPath, "utf8"));
    for (const key of ["noisy", "reference", "albedo", "worldNormal", "guidedCandidate"])
      if (!artifactIsBound(path.dirname(heldoutPath), heldout?.files?.[key]))
        fail("heldout-artifact-hash", path.relative(projectRoot, heldoutPath), key);
    if (
      heldout?.version !== 2 ||
      !hasReviewedHeldoutSemantics(heldout) ||
      heldout?.guidance?.albedoSpace !== "linear-rgb" ||
      heldout?.guidance?.worldNormalEncoding !== "xyz-remapped-[0,1]" ||
      guided.candidateOutput.file !== "heldout/" + heldout?.files?.guidedCandidate?.file
    )
      fail(
        "heldout-v2-contract",
        path.relative(projectRoot, heldoutPath),
        "guidance artifacts required",
      );
  } catch {
    fail("heldout-manifest-json", path.relative(projectRoot, heldoutPath), "valid JSON required");
  }
  if (requireGuidedReview)
    fail(
      "guided-model-not-reviewed",
      "public/models/neural-denoiser.manifest.json",
      "release requires a reviewed guided ONNX model with audited quality improvement",
    );
}
