import { createHash } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadRenderingAssetManifest,
  loadRenderingSourceLock,
  projectRoot,
  validateRenderingAssets,
} from "../scripts/assets/manifest.mjs";
import { findFetchBlockers } from "../scripts/assets/fetch-sources.mjs";
import {
  findReviewedRebuildBlockers,
  reviewedToolchain,
} from "../scripts/assets/rebuild-reviewed-assets.mjs";
import {
  renderClusteredCourtyardProxyContract,
  renderCalibrationRigContract,
  renderCornellSceneContract,
  renderReferenceFrameProceduralContract,
  renderResearchCourtyardPlaceholderPack,
  renderVisibilityInstanceFieldContract,
} from "../scripts/assets/build-placeholder-pack.mjs";
import { demoRegistry } from "../src/demos/core/registry";
import {
  formatAssetBytes,
  plannedRenderingSources,
  renderingAssets,
  type RenderingAssetManifest,
  type RenderingSourceLock,
} from "../src/data/rendering-assets";

describe("rendering asset pipeline", () => {
  it("binds the published self-authored assets to exact hashes, budgets, and packed-scene invariants", () => {
    expect(validateRenderingAssets(projectRoot)).toEqual([]);

    const manifest = loadRenderingAssetManifest(projectRoot) as RenderingAssetManifest;
    const pack = manifest.assets.find((asset) => asset.id === "research-courtyard");
    expect(manifest.assets).toHaveLength(8);
    expect(pack).toMatchObject({
      license: "self-authored",
      triangles: 14,
      lodTriangles: [14, 10, 6],
      usedBy: [],
      plannedFor: ["clustered-lighting", "gpu-particles", "shadow-aa", "frame-inspector"],
    });
    expect(pack?.bytes).toBeLessThanOrEqual(manifest.budget.courtyardGeometryBytes);
    expect(renderingAssets.map((asset) => asset.id)).toEqual(
      manifest.assets.map((asset) => asset.id),
    );
    expect(formatAssetBytes(3501)).toBe("3.4 KB");
  });

  it("keeps the public placeholder pack deterministic", () => {
    const actual = readFileSync(
      path.join(projectRoot, "public/assets/rendering/packs/research-courtyard.pack.json"),
      "utf8",
    );
    expect(actual).toBe(renderResearchCourtyardPlaceholderPack());
    expect(
      readFileSync(
        path.join(projectRoot, "public/assets/rendering/contracts/calibration-rig.contract.json"),
        "utf8",
      ),
    ).toBe(renderCalibrationRigContract());
    expect(
      readFileSync(
        path.join(projectRoot, "public/assets/rendering/contracts/cornell-scene.contract.json"),
        "utf8",
      ),
    ).toBe(renderCornellSceneContract());
    expect(
      readFileSync(
        path.join(
          projectRoot,
          "public/assets/rendering/contracts/clustered-courtyard-proxy.contract.json",
        ),
        "utf8",
      ),
    ).toBe(renderClusteredCourtyardProxyContract());
    expect(
      readFileSync(
        path.join(
          projectRoot,
          "public/assets/rendering/contracts/reference-frame-procedural.contract.json",
        ),
        "utf8",
      ),
    ).toBe(renderReferenceFrameProceduralContract());
    expect(
      readFileSync(
        path.join(
          projectRoot,
          "public/assets/rendering/contracts/visibility-instance-field.contract.json",
        ),
        "utf8",
      ),
    ).toBe(renderVisibilityInstanceFieldContract());
  });

  it("resolves every Registry assetId to a real audited record", () => {
    const manifest = loadRenderingAssetManifest(projectRoot) as RenderingAssetManifest;
    const resolved = new Set(manifest.assets.map((asset) => asset.id));
    const registryAssetIds = Object.values(demoRegistry).flatMap(
      ({ definition }) => definition.assetIds,
    );

    expect(registryAssetIds).toEqual(
      expect.arrayContaining([
        "calibration-rig",
        "clustered-courtyard-proxy",
        "reference-frame-procedural",
        "visibility-instance-field",
        "cornell-scene",
        "neural-heldout-v2",
      ]),
    );
    expect(registryAssetIds.every((id) => resolved.has(id))).toBe(true);
    expect(manifest.assets.find((asset) => asset.id === "neural-heldout-v2")).toMatchObject({
      kind: "neural-data",
      path: "public/models/neural-denoiser.manifest.json",
    });
  });

  it("records the six meshes, four materials, and HDRI as CC0 planned sources without claiming they ship", () => {
    const sourceLock = loadRenderingSourceLock(projectRoot) as RenderingSourceLock;
    expect(sourceLock.version).toBe(2);
    expect(sourceLock.policy.downloaded).toBe(false);
    expect(sourceLock.defaults).toMatchObject({ license: "CC0", status: "metadata-locked" });
    expect(sourceLock.sources).toHaveLength(11);
    expect(sourceLock.sources.filter((source) => source.kind === "mesh")).toHaveLength(6);
    expect(sourceLock.sources.filter((source) => source.kind === "texture")).toHaveLength(4);
    expect(sourceLock.sources.filter((source) => source.kind === "hdri")).toHaveLength(1);
    expect(
      plannedRenderingSources.every((source) =>
        source.sourceUrl.startsWith("https://polyhaven.com/a/"),
      ),
    ).toBe(true);
    expect(plannedRenderingSources.every((source) => source.status === "metadata-locked")).toBe(
      true,
    );
    expect(
      plannedRenderingSources.every(
        (source) => Array.isArray(source.authors) && source.authors.length > 0,
      ),
    ).toBe(true);
    const selectedFileCount = sourceLock.sources.reduce(
      (total, source) => total + source.files.length,
      0,
    );
    expect(selectedFileCount).toBeGreaterThan(11);
    expect(
      sourceLock.sources.every((source) =>
        source.files.every(
          (file) =>
            file.directUrl.startsWith("https://dl.polyhaven.org/file/") &&
            file.sha256 === null &&
            file.status === "metadata-locked" &&
            file.cachePath.startsWith(`.cache/rendering-sources/${source.id}/`),
        ),
      ),
    ).toBe(true);
    expect(findFetchBlockers(sourceLock)).toHaveLength(selectedFileCount);
    const expectedVersions = new Map(reviewedToolchain.map((tool) => [tool.command, tool.version]));
    expect(
      findReviewedRebuildBlockers(sourceLock, (command) => expectedVersions.get(command) ?? ""),
    ).toHaveLength(selectedFileCount + 1);
    expect(findReviewedRebuildBlockers(sourceLock, () => "")).toEqual(
      expect.arrayContaining([
        expect.stringContaining("gltf-transform@4.4.2"),
        expect.stringContaining("gltfpack@1.1"),
        expect.stringContaining("toktx@4.4.2"),
      ]),
    );
  });

  it("accepts a fully reviewed source state without weakening Preview fail-closed checks", () => {
    const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "rendering-assets-reviewed-"));
    try {
      const fixtureAssets = path.join(fixtureRoot, "public", "assets");
      mkdirSync(fixtureAssets, { recursive: true });
      cpSync(
        path.join(projectRoot, "public", "assets", "rendering"),
        path.join(fixtureAssets, "rendering"),
        { recursive: true },
      );
      cpSync(
        path.join(projectRoot, "public", "models"),
        path.join(fixtureRoot, "public", "models"),
        { recursive: true },
      );

      const renderingRoot = path.join(fixtureAssets, "rendering");
      const manifestPath = path.join(renderingRoot, "manifest.json");
      const sourceLockPath = path.join(renderingRoot, "sources.lock.json");
      const packPath = path.join(renderingRoot, "packs", "research-courtyard.pack.json");
      const runtimeManifestPath = path.join(renderingRoot, "manifests", "research-courtyard.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as RenderingAssetManifest;
      const sourceLock = JSON.parse(readFileSync(sourceLockPath, "utf8")) as RenderingSourceLock;
      const pack = JSON.parse(readFileSync(packPath, "utf8")) as { placeholder: boolean };
      pack.placeholder = false;
      writeFileSync(packPath, `${JSON.stringify(pack, null, 2)}\n`);

      manifest.status = "reviewed";
      manifest.generatedBy = "reviewed-fixture-compiler";
      const courtyard = manifest.assets.find((asset) => asset.id === "research-courtyard")!;
      courtyard.role = "packed-scene";
      courtyard.usedBy = ["clustered-lighting"];
      delete courtyard.plannedFor;
      courtyard.outputSha256 = createHash("sha256").update(readFileSync(packPath)).digest("hex");
      courtyard.bytes = statSync(packPath).size;
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      writeFileSync(
        runtimeManifestPath,
        `${JSON.stringify({ version: 1, assets: [courtyard] }, null, 2)}\n`,
      );

      sourceLock.policy.downloaded = true;
      sourceLock.sources = sourceLock.sources.map((source, sourceIndex) => ({
        ...source,
        files: source.files.map((file, fileIndex) => ({
          ...file,
          sha256: (sourceIndex * 100 + fileIndex).toString(16).padStart(64, "a").slice(-64),
          status: "reviewed" as const,
        })),
      }));
      writeFileSync(sourceLockPath, `${JSON.stringify(sourceLock, null, 2)}\n`);

      expect(validateRenderingAssets(fixtureRoot)).toEqual([]);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("fails closed when a tracked asset byte changes after its hash is recorded", () => {
    const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "rendering-assets-"));
    try {
      const fixtureAssets = path.join(fixtureRoot, "public", "assets");
      mkdirSync(fixtureAssets, { recursive: true });
      cpSync(
        path.join(projectRoot, "public", "assets", "rendering"),
        path.join(fixtureAssets, "rendering"),
        {
          recursive: true,
        },
      );
      writeFileSync(
        path.join(fixtureAssets, "rendering", "fallbacks", "research-courtyard.svg"),
        "tampered",
      );
      expect(validateRenderingAssets(fixtureRoot)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "rendering-asset-hash" }),
          expect.objectContaining({ code: "rendering-asset-size" }),
        ]),
      );
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
