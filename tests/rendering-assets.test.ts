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

function attachFixtureReviewEvidence(fixtureRoot: string, sourceLock: RenderingSourceLock) {
  const reviewId = "fixture-review";
  const reviewer = "fixture-reviewer";
  const reviewedAt = "2026-09-02T00:00:00.000Z";
  const relativePath = `public/assets/rendering/reviews/${reviewId}.json`;
  const descriptor = {
    version: 1,
    reviewId,
    sourceSetSha256: sourceLock.sourceSetSha256,
    reviewer,
    reviewedAt,
    packet: {
      path: `.cache/rendering-quarantine/${reviewId}/review-packet/machine.json`,
      sha256: "a".repeat(64),
    },
  };
  const bytes = Buffer.from(`${JSON.stringify(descriptor, null, 2)}\n`);
  const target = path.join(fixtureRoot, ...relativePath.split("/"));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  sourceLock.review = {
    reviewId,
    evidencePath: relativePath,
    evidenceSha256: createHash("sha256").update(bytes).digest("hex"),
    reviewer,
    reviewedAt,
  };
}

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

  it("records the human-reviewed CC0 source set without claiming it is integrated or public", () => {
    const sourceLock = loadRenderingSourceLock(projectRoot) as RenderingSourceLock;
    expect(sourceLock.version).toBe(3);
    expect(sourceLock.policy.stage).toBe("sources-reviewed");
    expect(sourceLock.sourceSetSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(sourceLock.review).toMatchObject({
      reviewId: "20260901-research-courtyard-v3b",
      reviewer: "yzscodehub",
      evidencePath: "public/assets/rendering/reviews/20260901-research-courtyard-v3b.json",
    });
    expect(sourceLock).not.toHaveProperty("integration");
    expect(sourceLock.policy).not.toHaveProperty("downloaded");
    expect(sourceLock).not.toHaveProperty("defaults");
    expect(sourceLock.sources).toHaveLength(11);
    expect(sourceLock.sources.filter((source) => source.kind === "mesh")).toHaveLength(6);
    expect(sourceLock.sources.filter((source) => source.kind === "texture")).toHaveLength(4);
    expect(sourceLock.sources.filter((source) => source.kind === "hdri")).toHaveLength(1);
    expect(
      plannedRenderingSources.every((source) =>
        source.sourceUrl.startsWith("https://polyhaven.com/a/"),
      ),
    ).toBe(true);
    expect(plannedRenderingSources.every((source) => source.status === "sources-reviewed")).toBe(
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
    expect(selectedFileCount).toBe(49);
    expect(
      sourceLock.sources.every((source) =>
        source.files.every(
          (file) =>
            file.directUrl.startsWith("https://dl.polyhaven.org/file/") &&
            /^[a-f0-9]{64}$/.test(file.sha256 ?? "") &&
            file.status === "reviewed" &&
            file.cachePath.startsWith(`.cache/rendering-sources/${source.id}/`),
        ),
      ),
    ).toBe(true);
    expect(findFetchBlockers(sourceLock)).toEqual([]);
    expect(findReviewedRebuildBlockers(sourceLock, { toolchainIssues: [] })).toEqual([]);
    expect(
      findReviewedRebuildBlockers(sourceLock, {
        toolchainIssues: reviewedToolchain.map(
          (tool) => `${tool.command}@${tool.version} is unavailable`,
        ),
      }),
    ).toEqual(
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
      const fixtureScripts = path.join(fixtureRoot, "scripts", "assets");
      mkdirSync(fixtureScripts, { recursive: true });
      cpSync(
        path.join(projectRoot, "scripts", "assets", "toolchain.lock.json"),
        path.join(fixtureScripts, "toolchain.lock.json"),
      );
      cpSync(
        path.join(projectRoot, "scripts", "assets", "research-courtyard.recipe.json"),
        path.join(fixtureScripts, "research-courtyard.recipe.json"),
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

      sourceLock.policy.stage = "integrated";
      attachFixtureReviewEvidence(fixtureRoot, sourceLock);
      sourceLock.sources = sourceLock.sources.map((source, sourceIndex) => ({
        ...source,
        files: source.files.map((file, fileIndex) => ({
          ...file,
          sha256: (sourceIndex * 100 + fileIndex).toString(16).padStart(64, "a").slice(-64),
          status: "reviewed" as const,
        })),
      }));
      writeFileSync(sourceLockPath, `${JSON.stringify(sourceLock, null, 2)}\n`);
      sourceLock.integration = {
        recipeSha256: createHash("sha256")
          .update(readFileSync(path.join(fixtureScripts, "research-courtyard.recipe.json")))
          .digest("hex"),
        toolchainLockSha256: createHash("sha256")
          .update(readFileSync(path.join(fixtureScripts, "toolchain.lock.json")))
          .digest("hex"),
        runtimeManifestPath: "public/assets/rendering/manifests/research-courtyard.json",
        runtimeManifestSha256: createHash("sha256")
          .update(readFileSync(runtimeManifestPath))
          .digest("hex"),
      };
      writeFileSync(sourceLockPath, `${JSON.stringify(sourceLock, null, 2)}\n`);

      expect(validateRenderingAssets(fixtureRoot)).toEqual([]);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("allows a Preview lock to hold reviewed source hashes before pack integration", () => {
    const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "rendering-sources-reviewed-"));
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
      const sourceLockPath = path.join(fixtureAssets, "rendering", "sources.lock.json");
      const sourceLock = JSON.parse(readFileSync(sourceLockPath, "utf8")) as RenderingSourceLock;
      sourceLock.policy.stage = "sources-reviewed";
      attachFixtureReviewEvidence(fixtureRoot, sourceLock);
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
