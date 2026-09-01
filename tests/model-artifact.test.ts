import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizeHeldoutManifest,
  normalizeNeuralModelManifest,
} from "../src/demos/neural-v2-contract";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelRoot = path.join(root, "public", "models");

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

describe("neural denoiser v2 artifacts", () => {
  it("binds the reviewed RGB ONNX and an explicitly unreviewed guided candidate", () => {
    const manifestPath = path.join(modelRoot, "neural-denoiser.manifest.json");
    const raw = JSON.parse(readFileSync(manifestPath, "utf8"));
    const manifest = normalizeNeuralModelManifest(raw);
    const rgbPath = path.join(modelRoot, manifest.rgb.file);

    expect(manifest.version).toBe(2);
    expect(manifest.migratedFromV1).toBe(false);
    expect(manifest.rgb.status).toBe("reviewed");
    expect(manifest.rgb.kind).toBe("onnx");
    expect(manifest.rgb.input.shape).toEqual([1, 3, 256, 256]);
    expect(statSync(rgbPath).size).toBe(manifest.rgb.bytes);
    expect(sha256(rgbPath)).toBe(manifest.rgb.sha256);
    expect(manifest.rgb.bytes).toBeLessThanOrEqual(5 * 1024 * 1024);

    expect(manifest.guided).toMatchObject({
      id: "guided",
      status: "candidate",
      kind: "static-candidate",
      input: { name: "noisy_albedo_world_normal", shape: [1, 9, 256, 256] },
      output: { name: "denoised_rgb", shape: [1, 3, 256, 256] },
    });
    expect(manifest.guided?.reason).toContain("No reviewed 9-channel checkpoint");
    expect(manifest.guided?.candidateOutput.file).not.toBe(manifest.rgb.file);
    expect(manifest.guided?.candidateOutput.sha256).not.toBe(manifest.rgb.sha256);
  });

  it("binds noisy, reference, albedo, normal, and candidate output by hash", () => {
    const rawModel = JSON.parse(
      readFileSync(path.join(modelRoot, "neural-denoiser.manifest.json"), "utf8"),
    );
    const model = normalizeNeuralModelManifest(rawModel);
    const heldoutPath = path.join(modelRoot, model.heldoutManifest.file);
    expect(statSync(heldoutPath).size).toBe(model.heldoutManifest.bytes);
    expect(sha256(heldoutPath)).toBe(model.heldoutManifest.sha256);

    const heldout = normalizeHeldoutManifest(JSON.parse(readFileSync(heldoutPath, "utf8")));
    expect(heldout.version).toBe(2);
    expect(heldout.migratedFromV1).toBe(false);
    expect(heldout.files.albedo).toBeDefined();
    expect(heldout.files.worldNormal).toBeDefined();
    expect(heldout.files.guidedCandidate).toBeDefined();
    for (const entry of Object.values(heldout.files)) {
      if (!entry) continue;
      const file = path.join(path.dirname(heldoutPath), entry.file);
      expect(entry.file).toMatch(/\.f16$/);
      expect(entry.bytes).toBe(3 * 256 * 256 * 2);
      expect(statSync(file).size).toBe(entry.bytes);
      expect(sha256(file)).toBe(entry.sha256);
    }
    expect(model.guided?.candidateOutput.file).toBe(
      "heldout/" + heldout.files.guidedCandidate?.file,
    );
  });
});
