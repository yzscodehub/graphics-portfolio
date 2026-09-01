import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildManifestFileName,
  sha256Bytes,
  verifyBuildManifest,
  writeBuildManifest,
} from "../scripts/write-build-manifest.mjs";

const fixtureGit = {
  commit: "a".repeat(40),
  dirty: true,
  treeSha256: "b".repeat(64),
  files: 7,
};
const fixtureEnvironment = { SITE_STAGE: "preview", SOURCE_REF: "feature/rendering-demo-v2" };

describe("build identity manifest", () => {
  it("binds the build stage, source inputs, and dist tree while excluding itself", () => {
    const root = makeFixture();
    try {
      const manifest = writeBuildManifest({
        root,
        environment: fixtureEnvironment,
        git: fixtureGit,
      });

      expect(manifest).toMatchObject({
        version: 1,
        stage: "preview",
        git: fixtureGit,
        sourceRef: "feature/rendering-demo-v2",
        summary: {
          rendering: {
            assetStatus: "preview-placeholder",
            sourceLockStage: "metadata-locked",
          },
          acceptance: {
            status: "pending",
            hasReviewedRun: false,
            demos: [{ slug: "material-lighting", status: "pending" }],
          },
          neural: {
            version: 2,
            guidedStatus: "candidate",
          },
        },
        dist: {
          excluded: [buildManifestFileName],
          files: 1,
        },
      });
      expect(manifest.inputs.pnpmLock.sha256).toBe(sha256Bytes(Buffer.from("lockfile")));
      expect(manifest.inputs.renderingSourceLock.path).toBe(
        "public/assets/rendering/sources.lock.json",
      );
      expect(
        JSON.parse(readFileSync(path.join(root, "dist", buildManifestFileName), "utf8")),
      ).toEqual(manifest);
      expect(
        verifyBuildManifest({ root, environment: fixtureEnvironment, git: fixtureGit }),
      ).toEqual(manifest);

      writeFileSync(path.join(root, "dist", "index.html"), "<main>changed</main>");
      expect(() =>
        verifyBuildManifest({ root, environment: fixtureEnvironment, git: fixtureGit }),
      ).toThrow("does not match");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function makeFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "graphics-portfolio-build-manifest-"));
  writeFixtureFile(root, "pnpm-lock.yaml", "lockfile");
  writeFixtureFile(
    root,
    "public/assets/rendering/sources.lock.json",
    JSON.stringify({ policy: { stage: "metadata-locked" } }),
  );
  writeFixtureFile(
    root,
    "public/assets/rendering/manifest.json",
    JSON.stringify({ status: "preview-placeholder" }),
  );
  writeFixtureFile(
    root,
    "public/evidence/rendering-v2-acceptance.json",
    JSON.stringify({
      status: "pending",
      reviewedRun: null,
      demos: [{ slug: "material-lighting", status: "pending" }],
    }),
  );
  writeFixtureFile(
    root,
    "public/models/neural-denoiser.manifest.json",
    JSON.stringify({ version: 2, models: [{ id: "guided", status: "candidate" }] }),
  );
  writeFixtureFile(root, "dist/index.html", "<main>fixture</main>");
  return root;
}

function writeFixtureFile(root: string, relativePath: string, contents: string) {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents);
}
