import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelPath = path.join(root, "public", "models", "neural-denoiser.onnx");
const metricsPath = path.join(root, "public", "models", "neural-denoiser.metrics.json");
const heldoutRoot = path.join(root, "public", "models", "heldout");

interface Metrics {
  modelBytes: number;
  validation: {
    samples: number;
    noisy: { l1: number; psnrDb: number };
    denoised: { l1: number; psnrDb: number };
  };
  onnxParity: { maxAbsoluteDifference: number; tolerance: number; passed: boolean };
}

describe("reviewed neural denoiser artifact", () => {
  it("matches its model card metrics and improves the held-out validation split", () => {
    const metrics = JSON.parse(readFileSync(metricsPath, "utf8")) as Metrics;
    const bytes = statSync(modelPath).size;
    expect(bytes).toBe(metrics.modelBytes);
    expect(bytes).toBeLessThanOrEqual(5 * 1024 * 1024);
    expect(metrics.validation.samples).toBe(16);
    expect(metrics.validation.denoised.l1).toBeLessThan(metrics.validation.noisy.l1);
    expect(metrics.validation.denoised.psnrDb).toBeGreaterThan(metrics.validation.noisy.psnrDb);
    expect(metrics.onnxParity.passed).toBe(true);
    expect(metrics.onnxParity.maxAbsoluteDifference).toBeLessThanOrEqual(
      metrics.onnxParity.tolerance,
    );
  });

  it("ships a hashed float32 held-out browser pair", () => {
    const manifest = JSON.parse(readFileSync(path.join(heldoutRoot, "manifest.json"), "utf8")) as {
      split: string;
      shape: number[];
      files: Record<string, { file: string; bytes: number; sha256: string }>;
    };
    expect(manifest.split).toBe("val");
    expect(manifest.shape).toEqual([1, 3, 256, 256]);
    for (const entry of Object.values(manifest.files)) {
      const file = path.join(heldoutRoot, entry.file);
      const bytes = readFileSync(file);
      expect(bytes.length).toBe(entry.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry.sha256);
    }
  });
});
