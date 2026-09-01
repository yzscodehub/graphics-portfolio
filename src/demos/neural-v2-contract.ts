export interface ArtifactDescriptor {
  file: string;
  bytes: number;
  sha256: string;
}

export interface TensorContract<Channels extends 3 | 9 = 3 | 9> {
  name: string;
  dtype: "float32";
  shape: [1, Channels, 256, 256];
  layout: "NCHW";
  range: "[0,1]";
}

export interface ReviewedRgbModel extends ArtifactDescriptor {
  id: "rgb";
  status: "reviewed";
  kind: "onnx";
  format: "onnx";
  opset: 17;
  input: TensorContract<3>;
  output: TensorContract<3>;
}

export interface GuidedStaticCandidate {
  id: "guided";
  status: "candidate";
  kind: "static-candidate";
  input: TensorContract<9>;
  output: TensorContract<3>;
  candidateOutput: ArtifactDescriptor;
  reason: string;
}

export interface NormalizedNeuralModelManifest {
  version: 2;
  migratedFromV1: boolean;
  rgb: ReviewedRgbModel;
  guided?: GuidedStaticCandidate;
  heldoutManifest: ArtifactDescriptor;
}

export interface NormalizedHeldoutManifest {
  version: 2;
  migratedFromV1: boolean;
  shape: [1, 3, 256, 256];
  files: {
    noisy: ArtifactDescriptor;
    reference: ArtifactDescriptor;
    albedo?: ArtifactDescriptor;
    worldNormal?: ArtifactDescriptor;
    guidedCandidate?: ArtifactDescriptor;
  };
}

export function normalizeNeuralModelManifest(value: unknown): NormalizedNeuralModelManifest {
  if (!isRecord(value) || !isArtifact(value.heldoutManifest))
    throw new Error("Neural model manifest contract is incompatible.");

  if (value.version === 1 && isRecord(value.model)) {
    const rgb = asReviewedRgb({ ...value.model, id: "rgb", status: "reviewed", kind: "onnx" });
    return { version: 2, migratedFromV1: true, rgb, heldoutManifest: value.heldoutManifest };
  }

  if (value.version !== 2 || !Array.isArray(value.models) || value.models.length !== 2)
    throw new Error("Neural v2 model manifest contract is incompatible.");

  const rgbEntry = value.models.find((entry) => isRecord(entry) && entry.id === "rgb");
  const guidedEntry = value.models.find((entry) => isRecord(entry) && entry.id === "guided");
  return {
    version: 2,
    migratedFromV1: false,
    rgb: asReviewedRgb(rgbEntry),
    guided: asGuidedCandidate(guidedEntry),
    heldoutManifest: value.heldoutManifest,
  };
}

const reviewedDatasetManifestSha256 =
  "7b6eacc3eb5f32ed9e1ae14d76a1ffdf4fb426b7ac5fffeb025cac177fc7dd4c";

export function normalizeHeldoutManifest(value: unknown): NormalizedHeldoutManifest {
  if (
    !isRecord(value) ||
    !isRecord(value.files) ||
    !isHeldoutShape(value.shape) ||
    !isReviewedHeldoutSemantics(value)
  )
    throw new Error("Held-out manifest contract is incompatible.");
  const files = value.files;
  if (!isArtifact(files.noisy) || !isArtifact(files.reference))
    throw new Error("Held-out manifest requires hashed noisy and reference artifacts.");

  if (value.version === 1)
    return {
      version: 2,
      migratedFromV1: true,
      shape: value.shape,
      files: { noisy: files.noisy, reference: files.reference },
    };

  if (
    value.version !== 2 ||
    !isRecord(value.guidance) ||
    value.guidance.albedoSpace !== "linear-rgb" ||
    value.guidance.worldNormalEncoding !== "xyz-remapped-[0,1]" ||
    !isArtifact(files.albedo) ||
    !isArtifact(files.worldNormal) ||
    !isArtifact(files.guidedCandidate)
  )
    throw new Error("Held-out v2 manifest requires albedo, world-normal, and candidate artifacts.");

  return {
    version: 2,
    migratedFromV1: false,
    shape: value.shape,
    files: {
      noisy: files.noisy,
      reference: files.reference,
      albedo: files.albedo,
      worldNormal: files.worldNormal,
      guidedCandidate: files.guidedCandidate,
    },
  };
}

function isReviewedHeldoutSemantics(value: Record<string, unknown>): boolean {
  const exported = value.export;
  return (
    value.renderer === "procedural-cornell-mc-v1" &&
    value.split === "val" &&
    value.stem === "scene-0001" &&
    value.sceneSeed === 91_103 &&
    value.dtype === "float16-le" &&
    value.layout === "NCHW" &&
    value.noisySamplesPerPixel === 1 &&
    value.referenceSamplesPerPixel === 64 &&
    isRecord(exported) &&
    exported.version === "reviewed-web-pair-v2" &&
    exported.assetStem === "scene-0001" &&
    exported.sourceDatasetStem === "scene-0064" &&
    exported.datasetManifestSha256 === reviewedDatasetManifestSha256
  );
}

function asReviewedRgb(value: unknown): ReviewedRgbModel {
  if (
    !isRecord(value) ||
    value.id !== "rgb" ||
    value.status !== "reviewed" ||
    value.kind !== "onnx" ||
    value.format !== "onnx" ||
    value.opset !== 17 ||
    !isArtifact(value) ||
    !isTensor(value.input, "noisy_rgb", 3) ||
    !isTensor(value.output, "denoised_rgb", 3)
  )
    throw new Error("Reviewed RGB model contract is incompatible.");
  return value as unknown as ReviewedRgbModel;
}

function asGuidedCandidate(value: unknown): GuidedStaticCandidate {
  if (
    !isRecord(value) ||
    value.id !== "guided" ||
    value.status !== "candidate" ||
    value.kind !== "static-candidate" ||
    !isTensor(value.input, "noisy_albedo_world_normal", 9) ||
    !isTensor(value.output, "denoised_rgb", 3) ||
    !isArtifact(value.candidateOutput) ||
    typeof value.reason !== "string" ||
    value.reason.length === 0
  )
    throw new Error("Guided candidate contract is incompatible.");
  return value as unknown as GuidedStaticCandidate;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isArtifact(value: unknown): value is ArtifactDescriptor {
  return (
    isRecord(value) &&
    typeof value.file === "string" &&
    value.file.length > 0 &&
    typeof value.bytes === "number" &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes > 0 &&
    typeof value.sha256 === "string" &&
    /^[a-f0-9]{64}$/i.test(value.sha256)
  );
}

function isTensor<Channels extends 3 | 9>(
  value: unknown,
  name: string,
  channels: Channels,
): value is TensorContract<Channels> {
  return (
    isRecord(value) &&
    value.name === name &&
    value.dtype === "float32" &&
    value.layout === "NCHW" &&
    value.range === "[0,1]" &&
    Array.isArray(value.shape) &&
    value.shape.length === 4 &&
    value.shape[0] === 1 &&
    value.shape[1] === channels &&
    value.shape[2] === 256 &&
    value.shape[3] === 256
  );
}

function isHeldoutShape(value: unknown): value is [1, 3, 256, 256] {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value[0] === 1 &&
    value[1] === 3 &&
    value[2] === 256 &&
    value[3] === 256
  );
}
