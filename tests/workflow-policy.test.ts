import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const preview = readFileSync(".github/workflows/preview-pages.yml", "utf8");
const release = readFileSync(".github/workflows/release-pages.yml", "utf8");

describe("Pages deployment policy", () => {
  it("serializes Preview and Release through one Pages concurrency group", () => {
    expect(preview).toMatch(/concurrency:\s*\n\s+group: pages\s*\n/);
    expect(release).toMatch(/concurrency:\s*\n\s+group: pages\s*\n/);
  });

  it("keeps main verification active while gating only its deployment", () => {
    expect(preview).not.toMatch(/name: Verify and build preview\s*\n\s+if:/);
    expect(preview).toContain("git tag --list 'v*'");
    expect(preview).toContain("if: steps.deployment-policy.outputs.deploy == 'true'");
    expect(preview).toContain("if: needs.build.outputs.deploy-pages == 'true'");
  });

  it("deploys indexed artifacts only from version tags", () => {
    expect(release).toMatch(/tags:\s*\n\s+- "v\*"/);
    expect(release).not.toContain("workflow_dispatch:");
    expect(release).toContain("SITE_STAGE: release");
  });
});
