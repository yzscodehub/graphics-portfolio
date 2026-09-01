import { createHash } from "node:crypto";
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

  it("rejects explicit identity fields without treating technical prose as PII", async () => {
    const policy = (await import("./verify-preview.mjs")) as {
      findPreviewPolicyViolations(text: string, relativePath: string): Array<{ code: string }>;
    };
    const violations = policy.findPreviewPolicyViolations(
      [
        'legalName: "Ada Lovelace",',
        "家庭住址：北京市海淀区示例路 1 号",
        'employer: "Example Graphics Studio",',
        "身份证号：11010519491231002X",
      ].join("\n"),
      "fixture.md",
    );

    expect(violations.map((violation) => violation.code)).toEqual(
      expect.arrayContaining([
        "legal-name-field",
        "home-address-field",
        "employment-identity-field",
        "prc-government-id",
      ]),
    );
    expect(
      policy.findPreviewPolicyViolations(
        "The company uses a GPU address calculation in an internal rendering architecture.",
        "technical-note.md",
      ),
    ).toEqual([]);
  });

  it("requires noindex, blocked robots, no PDFs, and a small model", async () => {
    const policy = (await import("./verify-preview.mjs")) as {
      validatePreviewArtifacts(root: string): Array<{ code: string }>;
    };
    const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "graphics-preview-policy-"));

    try {
      const modelRoot = path.join(fixtureRoot, "public", "models");
      mkdirSync(path.join(modelRoot, "heldout"), { recursive: true });
      mkdirSync(path.join(fixtureRoot, "dist"), { recursive: true });
      const model = Buffer.from("model");
      const heldout = Buffer.from('{"version":1}\n');
      writeFileSync(path.join(modelRoot, "neural-denoiser.onnx"), model);
      writeFileSync(path.join(modelRoot, "heldout", "manifest.json"), heldout);
      writeFileSync(
        path.join(modelRoot, "neural-denoiser.manifest.json"),
        JSON.stringify({
          version: 1,
          model: {
            file: "neural-denoiser.onnx",
            bytes: model.length,
            sha256: createHash("sha256").update(model).digest("hex"),
            format: "onnx",
            opset: 17,
            input: {
              name: "noisy_rgb",
              dtype: "float32",
              shape: [1, 3, 256, 256],
              layout: "NCHW",
              range: "[0,1]",
            },
            output: {
              name: "denoised_rgb",
              dtype: "float32",
              shape: [1, 3, 256, 256],
              layout: "NCHW",
              range: "[0,1]",
            },
          },
          heldoutManifest: {
            file: "heldout/manifest.json",
            bytes: heldout.length,
            sha256: createHash("sha256").update(heldout).digest("hex"),
          },
        }),
      );
      const acceptance = JSON.stringify({
        version: 1,
        status: "pending",
        target: {
          os: "Windows 11",
          adapterClass: "NVIDIA RTX 4070 class",
        },
        demos: [
          "material-lighting",
          "clustered-lighting",
          "shadow-aa",
          "render-graph",
          "frame-inspector",
          "gpu-particles",
          "path-tracer",
          "neural-denoising",
        ].map((slug) => ({ slug, status: "pending" })),
      });
      mkdirSync(path.join(fixtureRoot, "public", "evidence"), { recursive: true });
      mkdirSync(path.join(fixtureRoot, "dist", "evidence"), { recursive: true });
      writeFileSync(
        path.join(fixtureRoot, "public", "evidence", "rendering-v2-acceptance.json"),
        acceptance,
      );
      writeFileSync(
        path.join(fixtureRoot, "dist", "evidence", "rendering-v2-acceptance.json"),
        acceptance,
      );
      writeFileSync(path.join(fixtureRoot, "dist", "robots.txt"), "User-agent: *\nDisallow: /\n");
      writeFileSync(
        path.join(fixtureRoot, "dist", "index.html"),
        '<meta name="robots" content="noindex,nofollow">',
      );
      writeFileSync(
        path.join(fixtureRoot, "dist", "404.html"),
        '<meta name="robots" content="noindex,nofollow">',
      );

      expect(policy.validatePreviewArtifacts(fixtureRoot)).toEqual([]);

      writeFileSync(
        path.join(fixtureRoot, "dist", "404.html"),
        '<meta name="robots" content="noindex,nofollow"><link rel="canonical" href="https://example.invalid/404.html">',
      );
      expect(
        policy
          .validatePreviewArtifacts(fixtureRoot)
          .some((violation) => violation.code === "not-found-seo-metadata"),
      ).toBe(true);
      writeFileSync(
        path.join(fixtureRoot, "dist", "404.html"),
        '<meta name="robots" content="noindex,nofollow">',
      );

      writeFileSync(path.join(modelRoot, "neural-denoiser.onnx"), "tampered");
      expect(
        policy
          .validatePreviewArtifacts(fixtureRoot)
          .some((violation) => violation.code === "model-artifact-hash"),
      ).toBe(true);
      writeFileSync(path.join(modelRoot, "neural-denoiser.onnx"), model);

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
