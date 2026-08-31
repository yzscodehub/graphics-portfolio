import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelRoot = path.join(root, "public", "models");
const modelPath = path.join(modelRoot, "neural-denoiser.onnx");
const modelManifestPath = path.join(modelRoot, "neural-denoiser.manifest.json");
const metricsPath = path.join(modelRoot, "neural-denoiser.metrics.json");
const heldoutRoot = path.join(modelRoot, "heldout");
const modelCardPath = path.join(root, "training", "model-card.md");

interface ArtifactDescriptor {
  file: string;
  bytes: number;
  sha256: string;
}

interface ModelManifest {
  version: number;
  model: ArtifactDescriptor & {
    format: string;
    opset: number;
    input: { name: string; dtype: string; shape: number[]; layout: string; range: string };
    output: { name: string; dtype: string; shape: number[]; layout: string; range: string };
  };
  heldoutManifest: ArtifactDescriptor;
}

interface Metrics {
  modelBytes: number;
  validation: {
    samples: number;
    noisy: { l1: number; psnrDb: number };
    denoised: { l1: number; psnrDb: number };
  };
  onnxParity: { maxAbsoluteDifference: number; tolerance: number; passed: boolean };
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

describe("reviewed neural denoiser artifact", () => {
  it("binds the exact ONNX bytes, fixed contract, model card, and metrics", () => {
    const manifest = JSON.parse(readFileSync(modelManifestPath, "utf8")) as ModelManifest;
    const metrics = JSON.parse(readFileSync(metricsPath, "utf8")) as Metrics;
    const modelCard = readFileSync(modelCardPath, "utf8");
    const bytes = statSync(modelPath).size;
    const actualHash = sha256(modelPath);

    expect(manifest.version).toBe(1);
    expect(manifest.model).toMatchObject({
      file: "neural-denoiser.onnx",
      bytes,
      sha256: actualHash,
      format: "onnx",
      opset: 17,
      input: { name: "noisy_rgb", dtype: "float32", shape: [1, 3, 256, 256], layout: "NCHW" },
      output: { name: "denoised_rgb", dtype: "float32", shape: [1, 3, 256, 256], layout: "NCHW" },
    });
    expect(bytes).toBe(metrics.modelBytes);
    expect(bytes).toBeLessThanOrEqual(5 * 1024 * 1024);
    expect(modelCard).toContain(`ONNX size: ${bytes.toLocaleString("en-US")} bytes.`);
    expect(modelCard).toContain(`\`${actualHash}\``);
    expect(metrics.validation.samples).toBe(16);
    expect(metrics.validation.denoised.l1).toBeLessThan(metrics.validation.noisy.l1);
    expect(metrics.validation.denoised.psnrDb).toBeGreaterThan(metrics.validation.noisy.psnrDb);
    expect(metrics.onnxParity.passed).toBe(true);
    expect(metrics.onnxParity.maxAbsoluteDifference).toBeLessThanOrEqual(
      metrics.onnxParity.tolerance,
    );
  });

  it("binds a source-addressable, hashed float32 held-out browser pair", () => {
    const modelManifest = JSON.parse(readFileSync(modelManifestPath, "utf8")) as ModelManifest;
    const heldoutPath = path.join(modelRoot, modelManifest.heldoutManifest.file);
    const manifestBytes = statSync(heldoutPath).size;
    expect(manifestBytes).toBe(modelManifest.heldoutManifest.bytes);
    expect(sha256(heldoutPath)).toBe(modelManifest.heldoutManifest.sha256);

    const manifest = JSON.parse(readFileSync(heldoutPath, "utf8")) as {
      split: string;
      stem: string;
      sceneSeed: number;
      shape: number[];
      noisySamplesPerPixel: number;
      referenceSamplesPerPixel: number;
      export: {
        version: string;
        assetStem: string;
        sourceDatasetStem: string;
        datasetManifestSha256: string;
      };
      files: Record<string, ArtifactDescriptor>;
    };
    expect(manifest.split).toBe("val");
    expect(manifest.stem).toBe("scene-0001");
    expect(manifest.sceneSeed).toBe(91_103);
    expect(manifest.shape).toEqual([1, 3, 256, 256]);
    expect(manifest.noisySamplesPerPixel).toBe(1);
    expect(manifest.referenceSamplesPerPixel).toBe(64);
    expect(manifest.export).toMatchObject({
      version: "reviewed-web-pair-v2",
      assetStem: "scene-0001",
      sourceDatasetStem: "scene-0064",
    });
    expect(manifest.export.datasetManifestSha256).toMatch(/^[a-f0-9]{64}$/);
    for (const entry of Object.values(manifest.files)) {
      const file = path.join(heldoutRoot, entry.file);
      expect(statSync(file).size).toBe(entry.bytes);
      expect(sha256(file)).toBe(entry.sha256);
    }
  });
});
