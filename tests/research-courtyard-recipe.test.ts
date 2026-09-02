import { describe, expect, it } from "vitest";
import { loadRenderingSourceLock, projectRoot } from "../scripts/assets/manifest.mjs";
import {
  assertResearchCourtyardRecipe,
  loadResearchCourtyardRecipe,
  researchCourtyardRecipeSha256,
  validateResearchCourtyardRecipe,
} from "../scripts/assets/research-courtyard-recipe.mjs";

type MutableRecord = Record<string, unknown>;

const sourceLock = loadRenderingSourceLock(projectRoot);

function currentRecipe(): MutableRecord {
  return structuredClone(
    loadResearchCourtyardRecipe(projectRoot, { verifyFiles: false }),
  ) as MutableRecord;
}

function records(value: unknown): MutableRecord[] {
  return value as MutableRecord[];
}

function mesh(recipe: MutableRecord, sourceId: string): MutableRecord {
  return records(recipe.meshSources).find((entry) => entry.sourceId === sourceId)!;
}

function override(source: MutableRecord, materialName: string): MutableRecord {
  return records(source.materialOverrides).find((entry) => entry.materialName === materialName)!;
}

function validate(recipe: MutableRecord): string[] {
  return validateResearchCourtyardRecipe(recipe, sourceLock, {
    root: projectRoot,
    verifyFiles: false,
  });
}

describe("Research Courtyard recipe contract", () => {
  it("binds the exact reviewed source set, selected kit parts, and deterministic limits", () => {
    const recipe = currentRecipe();
    expect(validate(recipe)).toEqual([]);
    expect(researchCourtyardRecipeSha256(projectRoot)).toMatch(/^[a-f0-9]{64}$/);
    expect(recipe.sourceSetSha256).toBe(sourceLock.sourceSetSha256);
    expect(records(recipe.meshSources).map((entry) => entry.sourceId)).toHaveLength(6);
    expect(records(recipe.materialSources).map((entry) => entry.materialId)).toHaveLength(4);

    const hydrantParts = records(mesh(recipe, "fire-hydrant").parts);
    expect(hydrantParts).toHaveLength(1);
    expect(hydrantParts[0].nodeNames).toEqual([
      "fire_hydrant_aged",
      "fire_hydrant_cap_01_aged",
      "fire_hydrant_cap_02_aged",
      "fire_hydrant_cap_03_aged",
      "fire_hydrant_chain_aged",
    ]);
    const fenceParts = records(mesh(recipe, "modular-chainlink-fence").parts);
    expect(fenceParts.map((entry) => entry.partId)).toEqual([
      "door-latch",
      "door-gate",
      "door-frame",
      "double",
      "single",
      "post",
    ]);
    expect((recipe.publication as MutableRecord).heroEligible).toBe(false);
  });

  it("rejects source-set drift, unknown fields, and a changed reviewed file hash", () => {
    const sourceSet = currentRecipe();
    sourceSet.sourceSetSha256 = "0".repeat(64);
    expect(validate(sourceSet)[0]).toContain("sourceSetSha256 mismatch");

    const unknown = currentRecipe();
    unknown.unreviewedField = true;
    expect(validate(unknown)[0]).toContain("unknown or missing keys");

    const changedFile = currentRecipe();
    (mesh(changedFile, "concrete-cat-statue").gltf as MutableRecord).sha256 = "0".repeat(64);
    expect(validate(changedFile)[0]).toContain("does not match the reviewed source-lock record");
  });

  it("rejects duplicate instances, unknown parts, and non-finite transforms", () => {
    const duplicate = currentRecipe();
    const duplicateInstances = records(duplicate.instances);
    duplicateInstances.push(structuredClone(duplicateInstances[0]));
    expect(validate(duplicate)[0]).toContain("safe and unique");

    const unknownPart = currentRecipe();
    records(unknownPart.instances)[0].partId = "missing";
    expect(validate(unknownPart)[0]).toContain("unknown source part");

    const nonFinite = currentRecipe();
    const translation = records(nonFinite.instances)[0].translation as number[];
    translation[0] = Number.POSITIVE_INFINITY;
    expect(validate(nonFinite)[0]).toContain("must be finite");
  });

  it("keeps fence materials in MASK forward and normalizes meaningless BLEND claims", () => {
    const badPosts = currentRecipe();
    override(mesh(badPosts, "modular-chainlink-fence"), "modular_chainlink_fence_posts").alphaMode =
      "OPAQUE";
    expect(validate(badPosts)[0]).toContain(
      "all fence materials must be MASK/0.5/double-sided/forward",
    );

    const badWire = currentRecipe();
    const wire = override(mesh(badWire, "modular-chainlink-fence"), "modular_chainlink_fence_wire");
    (wire.textureTransform as MutableRecord).bakeIntoUv = false;
    expect(validate(badWire)[0]).toContain(
      "derive deterministic max-RGB alpha and bake UV transform",
    );

    const badCrate = currentRecipe();
    override(mesh(badCrate, "plastic-crate-02"), "plastic_crate_02").alphaMode = "BLEND";
    expect(validate(badCrate)[0]).toContain("crate BLEND must be normalized to opaque");
  });

  it("requires exactly one animated crate with previous-transform evidence", () => {
    const missingPrevious = currentRecipe();
    const animated = records(missingPrevious.instances).find(
      (entry) => entry.instanceId === "crate-animated",
    )!;
    (animated.animation as MutableRecord).writesPreviousTransform = false;
    expect(validate(missingPrevious)[0]).toContain(
      "only crate-animated may spin and must write previous transform",
    );

    expect(() =>
      assertResearchCourtyardRecipe(currentRecipe(), sourceLock, {
        root: projectRoot,
        verifyFiles: false,
      }),
    ).not.toThrow();
  });
});
