import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as os from "node:os";
import { describe, expect, it } from "vitest";

describe("preview privacy policy", () => {
  it("accepts only the preview site stage", async () => {
    const policy = (await import("./verify-preview.mjs")) as {
      validatePreviewStage(
        environment: Record<string, string | undefined>,
      ): Array<{ code: string }>;
    };

    expect(policy.validatePreviewStage({ SITE_STAGE: "preview" })).toEqual([]);
    expect(policy.validatePreviewStage({ SITE_STAGE: "release" })).toEqual([
      expect.objectContaining({ code: "stage" }),
    ]);
  });

  it("rejects public email placeholders and phone numbers", async () => {
    const policy = (await import("./verify-preview.mjs")) as {
      findPreviewPolicyViolations(text: string, relativePath: string): Array<{ code: string }>;
    };

    const violations = policy.findPreviewPolicyViolations(
      "const email = 'PUBLIC_EMAIL'; const phone = '138 0013 8000';",
      "fixture.ts",
    );

    expect(violations.map((violation) => violation.code)).toEqual(
      expect.arrayContaining(["public-email-placeholder", "phone-number"]),
    );
    expect(
      policy.findPreviewPolicyViolations(
        '{"sha256":"abcdef0123456789abcdef13800138000abcdef0123456789abcdef0123456789"}',
        "dist/og/manifest.json",
      ),
    ).toEqual([]);
  });

  it("requires noindex, blocked robots, no PDFs, and a small model", async () => {
    const policy = (await import("./verify-preview.mjs")) as {
      validatePreviewArtifacts(root: string): Array<{ code: string }>;
    };
    const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "graphics-preview-policy-"));

    try {
      mkdirSync(path.join(fixtureRoot, "public", "models"), { recursive: true });
      mkdirSync(path.join(fixtureRoot, "dist"), { recursive: true });
      writeFileSync(path.join(fixtureRoot, "public", "models", "neural-denoiser.onnx"), "model");
      writeFileSync(path.join(fixtureRoot, "dist", "robots.txt"), "User-agent: *\nDisallow: /\n");
      writeFileSync(
        path.join(fixtureRoot, "dist", "index.html"),
        '<meta name="robots" content="noindex,nofollow">',
      );

      expect(policy.validatePreviewArtifacts(fixtureRoot)).toEqual([]);

      writeFileSync(path.join(fixtureRoot, "dist", "resume.pdf"), "not a real PDF");
      const violations = policy.validatePreviewArtifacts(fixtureRoot);
      expect(violations.some((violation) => violation.code === "preview-pdf")).toBe(true);

      writeFileSync(path.join(fixtureRoot, "dist", "sitemap-index.xml"), "<urlset />");
      const sitemapViolations = policy.validatePreviewArtifacts(fixtureRoot);
      expect(sitemapViolations.some((violation) => violation.code === "preview-sitemap")).toBe(
        true,
      );
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("rejects generated PDFs tracked by the preview repository", async () => {
    const policy = (await import("./verify-preview.mjs")) as {
      findTrackedPreviewFileViolations(paths: string[]): Array<{ code: string; file: string }>;
    };

    expect(policy.findTrackedPreviewFileViolations(["README.md", "src/pages/index.astro"])).toEqual(
      [],
    );
    expect(
      policy.findTrackedPreviewFileViolations(["deferred/resume/public/resume/resume-zh-CN.pdf"]),
    ).toEqual([
      expect.objectContaining({
        code: "tracked-preview-pdf",
        file: "deferred/resume/public/resume/resume-zh-CN.pdf",
      }),
    ]);
  });
});
