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
      mkdirSync(path.join(fixtureRoot, "public", "models"), { recursive: true });
      writeFileSync(path.join(fixtureRoot, "public", "models", "neural-denoiser.onnx"), "model");
      mkdirSync(path.join(fixtureRoot, "public", "media"), { recursive: true });
      const mediaAssets = Object.entries({
        "demo-poster": 7,
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
      const cards = Array.from({ length: 22 }, (_, index) => {
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

      expect(policy.validateReleaseStage({ SITE_STAGE: "release" })).toEqual([]);
      expect(policy.validateReleaseStage({ SITE_STAGE: "preview" })).toEqual([
        expect.objectContaining({ code: "stage" }),
      ]);
      expect(policy.validateReleaseArtifacts(fixtureRoot)).toEqual([]);
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
