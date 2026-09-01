import { describe, expect, it } from "vitest";
import {
  normalizeHeldoutManifest,
  normalizeNeuralModelManifest,
} from "../src/demos/neural-v2-contract";

const artifact = {
  file: "artifact.bin",
  bytes: 1,
  sha256: "0".repeat(64),
};

const reviewedHeldout = {
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
};

describe("neural v2 contracts", () => {
  it("migrates a reviewed RGB v1 manifest without inventing a guided model", () => {
    const result = normalizeNeuralModelManifest({
      version: 1,
      model: {
        ...artifact,
        format: "onnx",
        opset: 17,
        input: {
          name: "noisy_rgb",
          dtype: "float32",
          shape: [1, 3, 256, 256],
          layout: "NCHW",
          range: "[0,1]",
        },
        output: {
          name: "denoised_rgb",
          dtype: "float32",
          shape: [1, 3, 256, 256],
          layout: "NCHW",
          range: "[0,1]",
        },
      },
      heldoutManifest: artifact,
    });
    expect(result.migratedFromV1).toBe(true);
    expect(result.rgb.status).toBe("reviewed");
    expect(result.guided).toBeUndefined();
  });

  it("requires all hash-bound guidance artifacts in v2 held-out data", () => {
    expect(() =>
      normalizeHeldoutManifest({
        ...reviewedHeldout,
        files: { noisy: artifact, reference: artifact },
      }),
    ).toThrow("albedo");
  });
});
