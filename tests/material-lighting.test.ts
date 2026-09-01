import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  isCalibrationRigContract,
  MATERIAL_PRESETS,
  materialPreset,
  type MaterialPresetId,
} from "../src/demos/material-lighting";

describe("Material & Color presets", () => {
  it("loads the audited Calibration Rig contract used by the runtime", () => {
    const file = fileURLToPath(
      new URL(
        "../public/assets/rendering/contracts/calibration-rig.contract.json",
        import.meta.url,
      ),
    );
    const contract: unknown = JSON.parse(readFileSync(file, "utf8"));
    expect(isCalibrationRigContract(contract)).toBe(true);
    expect(
      isCalibrationRigContract({ ...(contract as object), geometry: ["calibration-sphere"] }),
    ).toBe(false);
  });

  it("publishes four distinct, bounded material contracts", () => {
    const ids = Object.keys(MATERIAL_PRESETS) as MaterialPresetId[];
    expect(ids).toEqual(["dielectric", "metal", "rough", "clearcoat"]);
    expect(new Set(ids.map((id) => JSON.stringify(MATERIAL_PRESETS[id]))).size).toBe(4);
    for (const preset of Object.values(MATERIAL_PRESETS)) {
      expect(preset.baseColor).toMatch(/^#[a-f0-9]{6}$/i);
      for (const value of [
        preset.metalness,
        preset.roughness,
        preset.clearcoat,
        preset.clearcoatRoughness,
      ])
        expect(value).toBeGreaterThanOrEqual(0);
      expect(preset.metalness).toBeLessThanOrEqual(1);
      expect(preset.roughness).toBeLessThanOrEqual(1);
      expect(preset.clearcoat).toBeLessThanOrEqual(1);
      expect(preset.clearcoatRoughness).toBeLessThanOrEqual(1);
    }
  });

  it("keeps dielectric, metal, rough, and clearcoat semantics explicit", () => {
    expect(MATERIAL_PRESETS.dielectric.metalness).toBe(0);
    expect(MATERIAL_PRESETS.metal.metalness).toBe(1);
    expect(MATERIAL_PRESETS.rough.roughness).toBeGreaterThan(0.75);
    expect(MATERIAL_PRESETS.clearcoat.clearcoat).toBe(1);
  });

  it("returns a copy so control edits cannot mutate the audited preset", () => {
    const copy = materialPreset("metal");
    copy.roughness = 0.9;
    expect(MATERIAL_PRESETS.metal.roughness).toBe(0.2);
  });
});
