import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const preview = readFileSync(".github/workflows/preview-pages.yml", "utf8");
const release = readFileSync(".github/workflows/release-pages.yml", "utf8");

describe("Pages deployment policy", () => {
  it("verifies the build identity manifest before every browser suite", () => {
    for (const workflow of [ci, preview, release]) {
      expect(workflow).toContain("pnpm run build:manifest:verify");
    }
  });

  it("serializes Preview and Release through one Pages concurrency group", () => {
    expect(preview).toMatch(/concurrency:\s*\n\s+group: pages\s*\n/);
    expect(release).toMatch(/concurrency:\s*\n\s+group: pages\s*\n/);
  });

  it("keeps main verification active while gating only its deployment", () => {
    expect(preview).not.toMatch(/name: Verify and build preview\s*\n\s+if:/);
    expect(preview).toContain("vars.ENABLE_PREVIEW_PAGES");
    expect(preview).not.toContain("git tag --list 'v*'");
    expect(preview).toContain("if: steps.deployment-policy.outputs.deploy == 'true'");
    expect(preview).toContain("if: needs.build.outputs.deploy-pages == 'true'");
  });

  it("deploys indexed artifacts only from version tags", () => {
    expect(release).toMatch(/tags:\s*\n\s+- "v\*"/);
    expect(release).not.toContain("workflow_dispatch:");
    expect(release).toContain("SITE_STAGE: release");
    expect(release).toContain("vars.ENABLE_PREVIEW_PAGES");
    expect(release).toContain(
      "Set the persistent ENABLE_PREVIEW_PAGES repository variable to false",
    );
    expect(release).toContain("Release tags must use stable SemVer");
    expect(release).toContain(
      "git fetch origin +refs/heads/main:refs/remotes/origin/main --no-tags",
    );
    expect(release).toContain('[[ "$(git rev-parse origin/main)" != "${GITHUB_SHA}" ]]');
    expect(release).toContain("point exactly to the current origin/main HEAD");
    expect(release).not.toContain("git merge-base --is-ancestor");
  });
});
