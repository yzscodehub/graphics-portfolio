import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as os from "node:os";
import { describe, expect, it } from "vitest";

const verifier = fileURLToPath(new URL("./verify-production.mjs", import.meta.url));

describe("production privacy policy", () => {
  it("requires the release stage but no longer requires email or resume PDFs", async () => {
    const policy = (await import("./verify-production.mjs")) as {
      validateReleaseStage(
        environment: Record<string, string | undefined>,
      ): Array<{ code: string }>;
      validateReleaseArtifacts(root: string): Array<{ code: string }>;
    };
    const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "graphics-release-policy-"));

    try {
      const modelRoot = path.join(fixtureRoot, "public", "models");
      mkdirSync(path.join(modelRoot, "heldout"), { recursive: true });
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
      const renderingRoot = path.join(fixtureRoot, "public", "assets", "rendering");
      mkdirSync(path.join(renderingRoot, "packs"), { recursive: true });
      mkdirSync(path.join(renderingRoot, "textures"), { recursive: true });
      const courtyardPath = "public/assets/rendering/packs/research-courtyard.pack.json";
      writeFileSync(
        path.join(fixtureRoot, courtyardPath),
        JSON.stringify({ version: 1, placeholder: false, meshes: [], materials: [] }),
      );
      writeFileSync(path.join(renderingRoot, "textures", "courtyard.ktx2"), "ktx2");
      writeFileSync(path.join(renderingRoot, "textures", "courtyard.webp"), "webp");
      writeFileSync(
        path.join(renderingRoot, "manifest.json"),
        JSON.stringify({
          version: 1,
          status: "reviewed",
          generatedBy: "fixture-asset-compiler",
          assets: [
            {
              id: "research-courtyard",
              role: "packed-scene",
              path: courtyardPath,
            },
          ],
        }),
      );
      writeFileSync(
        path.join(renderingRoot, "sources.lock.json"),
        JSON.stringify({
          version: 2,
          policy: { downloaded: true },
          sources: [
            {
              id: "fixture-courtyard",
              authors: ["Fixture Author"],
              license: "CC0",
              files: [
                {
                  directUrl: "https://dl.polyhaven.org/file/fixture/courtyard.glb",
                  sha256: "a".repeat(64),
                  status: "reviewed",
                },
              ],
            },
          ],
        }),
      );
      const courtyardRuntimeRoot = path.join(fixtureRoot, "src", "demos", "research-courtyard");
      mkdirSync(courtyardRuntimeRoot, { recursive: true });
      writeFileSync(
        path.join(courtyardRuntimeRoot, "scene.ts"),
        'export const source = "packed";\n',
      );
      const evidenceRoot = path.join(fixtureRoot, "public", "evidence");
      mkdirSync(evidenceRoot, { recursive: true });
      const capture = Buffer.from("reviewed hardware capture");
      const captureRelativePath = "public/evidence/reviewed-hardware-capture.bin";
      writeFileSync(path.join(fixtureRoot, captureRelativePath), capture);
      writeFileSync(
        path.join(evidenceRoot, "rendering-v2-acceptance.json"),
        JSON.stringify({
          version: 1,
          status: "reviewed",
          target: {
            os: "Windows 11",
            adapterClass: "NVIDIA RTX 4070 class",
            browser: "Chromium Stable",
            viewportWidth: 1920,
            viewportHeight: 1080,
            dpr: 1,
          },
          reviewedRun: {
            os: "Windows 11",
            adapter: "NVIDIA GeForce RTX 4070",
            browser: "Chromium Stable",
            browserVersion: "fixture",
            viewportWidth: 1920,
            viewportHeight: 1080,
            dpr: 1,
            reviewer: "fixture-reviewer",
            reviewedAt: "2026-08-31T00:00:00Z",
            evidencePath: captureRelativePath,
            evidenceSha256: createHash("sha256").update(capture).digest("hex"),
          },
          demos: [
            {
              slug: "material-lighting",
              status: "passed",
              metrics: { fpsP50: 60, frameTimeP95Ms: 22 },
            },
            {
              slug: "clustered-lighting",
              status: "passed",
              metrics: { fpsP50: 60, frameTimeP95Ms: 22, cluster512Overflow: 0 },
            },
            {
              slug: "shadow-aa",
              status: "passed",
              metrics: { fpsP50: 60, frameTimeP95Ms: 22 },
            },
            { slug: "render-graph", status: "passed", metrics: { functionalReview: true } },
            {
              slug: "frame-inspector",
              status: "passed",
              metrics: { fpsP50: 60, frameTimeP95Ms: 22, attachmentReadback: true },
            },
            {
              slug: "gpu-particles",
              status: "passed",
              metrics: { instances100kFpsP50: 60, particles250kFpsP50: 60 },
            },
            {
              slug: "path-tracer",
              status: "passed",
              metrics: { progressiveUpdatesPerSecond: 30 },
            },
            {
              slug: "neural-denoising",
              status: "passed",
              metrics: { webgpuP50Ms: 20, webgpuP95Ms: 30, wasmP50Ms: 250 },
            },
          ],
        }),
      );
      mkdirSync(path.join(fixtureRoot, "public", "media"), { recursive: true });
      const mediaAssets = Object.entries({
        "demo-poster": 8,
        "project-cover": 4,
        "project-architecture": 4,
        "demo-runtime-capture": 4,
      }).flatMap(([role, count]) =>
        Array.from({ length: count }, (_, index) => {
          const relative = `public/media/${role}-${index}.bin`;
          const media = Buffer.from(`${role}-${index}`);
          writeFileSync(path.join(fixtureRoot, relative), media);
          return {
            path: relative,
            role,
            owner: "yzscodehub",
            license: "self-authored",
            bytes: media.byteLength,
            width: 1600,
            height: 900,
            environment: "fixture",
            sha256: createHash("sha256").update(media).digest("hex"),
          };
        }),
      );
      writeFileSync(
        path.join(fixtureRoot, "public", "media", "assets-manifest.json"),
        JSON.stringify({
          version: 2,
          environments: [{ id: "fixture", measurement: "test" }],
          assets: mediaAssets,
        }),
      );
      mkdirSync(path.join(fixtureRoot, "public", "og"), { recursive: true });
      const cards = Array.from({ length: 25 }, (_, index) => {
        const relative = `/og/card-${index}.png`;
        const og = Buffer.from(`og-${index}`);
        writeFileSync(path.join(fixtureRoot, "public", relative), og);
        return {
          path: relative,
          title: `Card ${index}`,
          bytes: og.byteLength,
          width: 1200,
          height: 630,
          sha256: createHash("sha256").update(og).digest("hex"),
        };
      });
      writeFileSync(
        path.join(fixtureRoot, "public", "og", "manifest.json"),
        JSON.stringify({
          version: 2,
          cards,
        }),
      );
      mkdirSync(path.join(fixtureRoot, "dist"), { recursive: true });
      writeFileSync(
        path.join(fixtureRoot, "dist", "robots.txt"),
        "User-agent: *\nAllow: /\nSitemap: https://yzscodehub.github.io/graphics-portfolio/sitemap-index.xml\n",
      );
      writeFileSync(
        path.join(fixtureRoot, "dist", "sitemap-index.xml"),
        "<sitemapindex>https://yzscodehub.github.io/graphics-portfolio/</sitemapindex>",
      );
      writeFileSync(
        path.join(fixtureRoot, "dist", "rss.xml"),
        '<rss version="2.0">https://yzscodehub.github.io/graphics-portfolio/</rss>',
      );
      mkdirSync(path.join(fixtureRoot, "dist", "og"), { recursive: true });
      writeFileSync(path.join(fixtureRoot, "dist", "og", "card-0.png"), "og-0");
      writeFileSync(
        path.join(fixtureRoot, "dist", "index.html"),
        [
          '<link rel="canonical" href="https://yzscodehub.github.io/graphics-portfolio/">',
          '<meta property="og:url" content="https://yzscodehub.github.io/graphics-portfolio/">',
          '<meta property="og:image" content="https://yzscodehub.github.io/graphics-portfolio/og/card-0.png">',
          '<script type="application/ld+json">{}</script>',
        ].join(""),
      );
      writeFileSync(
        path.join(fixtureRoot, "dist", "404.html"),
        '<meta name="robots" content="noindex,nofollow">',
      );

      expect(policy.validateReleaseStage({ SITE_STAGE: "release" })).toEqual([]);
      expect(policy.validateReleaseStage({ SITE_STAGE: "preview" })).toEqual([
        expect.objectContaining({ code: "stage" }),
      ]);
      expect(policy.validateReleaseArtifacts(fixtureRoot)).toEqual([]);

      writeFileSync(
        path.join(renderingRoot, "manifest.json"),
        JSON.stringify({
          version: 1,
          status: "preview-placeholder",
          generatedBy: "build-placeholder-pack",
          assets: [
            {
              id: "research-courtyard",
              role: "packed-scene-placeholder",
              path: courtyardPath,
            },
          ],
        }),
      );
      expect(
        policy
          .validateReleaseArtifacts(fixtureRoot)
          .some((violation) => violation.code === "rendering-assets-not-reviewed"),
      ).toBe(true);
      writeFileSync(
        path.join(renderingRoot, "manifest.json"),
        JSON.stringify({
          version: 1,
          status: "reviewed",
          generatedBy: "fixture-asset-compiler",
          assets: [
            {
              id: "research-courtyard",
              role: "packed-scene",
              path: courtyardPath,
            },
          ],
        }),
      );

      writeFileSync(
        path.join(fixtureRoot, "dist", "index.html"),
        [
          '<link rel="canonical" href="https://yzscodehub.github.io/graphics-portfolio/">',
          '<meta property="og:url" content="https://yzscodehub.github.io/graphics-portfolio/">',
          '<meta property="og:image" content="https://yzscodehub.github.io/graphics-portfolio/og/not-in-manifest.png">',
          '<script type="application/ld+json">{}</script>',
        ].join(""),
      );
      expect(
        policy
          .validateReleaseArtifacts(fixtureRoot)
          .some((violation) => violation.code === "og-page-manifest"),
      ).toBe(true);
      writeFileSync(
        path.join(fixtureRoot, "dist", "index.html"),
        [
          '<link rel="canonical" href="https://yzscodehub.github.io/graphics-portfolio/">',
          '<meta property="og:url" content="https://yzscodehub.github.io/graphics-portfolio/">',
          '<meta property="og:image" content="https://yzscodehub.github.io/graphics-portfolio/og/card-1.png">',
          '<script type="application/ld+json">{}</script>',
        ].join(""),
      );
      expect(
        policy
          .validateReleaseArtifacts(fixtureRoot)
          .some((violation) => violation.code === "og-page-asset"),
      ).toBe(true);
      writeFileSync(
        path.join(fixtureRoot, "dist", "404.html"),
        '<meta name="robots" content="noindex,nofollow"><meta property="og:image" content="https://yzscodehub.github.io/graphics-portfolio/og/card-0.png">',
      );
      expect(
        policy
          .validateReleaseArtifacts(fixtureRoot)
          .some((violation) => violation.code === "not-found-seo-metadata"),
      ).toBe(true);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("keeps a pending high-end WebGPU review as a release blocker", async () => {
    const policy = (await import("./verify-production.mjs")) as {
      validateRenderingAcceptanceEvidence(root: string): Array<{ code: string }>;
    };
    const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "graphics-hardware-evidence-"));
    try {
      const evidenceRoot = path.join(fixtureRoot, "public", "evidence");
      mkdirSync(evidenceRoot, { recursive: true });
      writeFileSync(
        path.join(evidenceRoot, "rendering-v2-acceptance.json"),
        JSON.stringify({ version: 1, status: "pending" }),
      );
      expect(policy.validateRenderingAcceptanceEvidence(fixtureRoot)).toEqual([
        expect.objectContaining({ code: "high-end-rendering-evidence-pending" }),
      ]);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("does not interpret decimal model metrics as Chinese mobile numbers", async () => {
    const policy = (await import("./verify-production.mjs")) as {
      findPolicyViolations(text: string, relativePath: string): Array<{ code: string }>;
    };
    const violations = policy.findPolicyViolations(
      '{"mse":0.00000821846506288617,"psnr":50.852092867136605}',
      "model.metrics.json",
    );
    expect(violations.some((violation) => violation.code === "phone-number")).toBe(false);
    expect(
      policy.findPolicyViolations(
        '{"sha256":"abcdef0123456789abcdef13800138000abcdef0123456789abcdef0123456789"}',
        "dist/og/manifest.json",
      ),
    ).toEqual([]);
  });

  it("keeps the indexed release GitHub-only", async () => {
    const policy = (await import("./verify-production.mjs")) as {
      findPolicyViolations(text: string, relativePath: string): Array<{ code: string }>;
    };
    const violations = policy.findPolicyViolations(
      '<a href="mailto:public@example.com">mail</a>',
      "dist/index.html",
    );
    expect(violations.map((violation) => violation.code)).toEqual(
      expect.arrayContaining(["email-address", "email-link"]),
    );
  });

  it("rejects explicit identity fields without flagging ordinary technical vocabulary", async () => {
    const policy = (await import("./verify-production.mjs")) as {
      findPolicyViolations(text: string, relativePath: string): Array<{ code: string }>;
    };
    const violations = policy.findPolicyViolations(
      [
        "真实姓名：张三",
        'streetAddress: "1 Example Way",',
        'clientName: "Private Client",',
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
      policy.findPolicyViolations(
        "A company may use a device address for a customer-facing graphics feature.",
        "technical-note.md",
      ),
    ).toEqual([]);
  });

  it("blocks the unchecked public-identity placeholders before a release", () => {
    const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "graphics-portfolio-policy-"));
    const profileDirectory = path.join(fixtureRoot, "src", "data");
    mkdirSync(profileDirectory, { recursive: true });
    writeFileSync(
      path.join(profileDirectory, "profile.ts"),
      "export const handle = 'YOUR_HANDLE';\n",
    );

    const result = (() => {
      try {
        execFileSync(process.execPath, [verifier, fixtureRoot], {
          env: {
            ...process.env,
            SITE_URL: "https://yzscodehub.github.io",
            SITE_STAGE: "release",
          },
          encoding: "utf8",
          stdio: "pipe",
        });
        return "";
      } catch (error) {
        const processError = error as { stdout?: string; stderr?: string };
        return `${processError.stdout ?? ""}${processError.stderr ?? ""}`;
      }
    })();

    try {
      expect(result).toContain("[placeholder]");
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
