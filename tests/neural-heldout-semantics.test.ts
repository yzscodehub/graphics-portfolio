import { describe, expect, it } from "vitest";
import { normalizeHeldoutManifest } from "../src/demos/neural-v2-contract";

const artifact = {
  file: "artifact.f16",
  bytes: 1,
  sha256: "0".repeat(64),
};

function reviewedHeldout() {
  return {
    version: 2,
    renderer: "procedural-cornell-mc-v1",
    split: "val",
    stem: "scene-0001",
    sceneSeed: 91_103,
    shape: [1, 3, 256, 256],
    dtype: "float16-le",
    layout: "NCHW",
    noisySamplesPerPixel: 1,
    referenceSamplesPerPixel: 64,
    export: {
      version: "reviewed-web-pair-v2",
      assetStem: "scene-0001",
      sourceDatasetStem: "scene-0064",
      datasetManifestSha256: "7b6eacc3eb5f32ed9e1ae14d76a1ffdf4fb426b7ac5fffeb025cac177fc7dd4c",
    },
    guidance: {
      albedoSpace: "linear-rgb",
      worldNormalEncoding: "xyz-remapped-[0,1]",
    },
    files: {
      noisy: artifact,
      reference: artifact,
      albedo: artifact,
      worldNormal: artifact,
      guidedCandidate: artifact,
    },
  };
}

describe("reviewed Neural held-out semantics", () => {
  it("accepts the fixed validation provenance", () => {
    expect(normalizeHeldoutManifest(reviewedHeldout()).migratedFromV1).toBe(false);
  });

  it("rejects a hash-bound artifact relabeled as training data", () => {
    expect(() => normalizeHeldoutManifest({ ...reviewedHeldout(), split: "train" })).toThrow(
      "contract",
    );
  });

  it("rejects drift in the source-dataset provenance hash", () => {
    expect(() =>
      normalizeHeldoutManifest({
        ...reviewedHeldout(),
        export: { ...reviewedHeldout().export, datasetManifestSha256: "1".repeat(64) },
      }),
    ).toThrow("contract");
  });
});
