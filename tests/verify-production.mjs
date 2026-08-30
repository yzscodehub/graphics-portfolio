import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveSiteFeatures } from "../src/data/site-stage.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceExtensions = new Set([
  ".astro",
  ".css",
  ".html",
  ".json",
  ".js",
  ".mjs",
  ".md",
  ".mdx",
  ".ts",
  ".tsx",
  ".xml",
]);
const renderedExtensions = new Set([".html", ".json", ".xml"]);

const forbiddenRules = [
  {
    code: "placeholder",
    pattern: /YOUR_HANDLE|PUBLIC_EMAIL|GITHUB_USERNAME|hello@example\.com|your name/gi,
  },
  {
    code: "email-address",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  },
  { code: "email-link", pattern: /mailto:/gi },
  { code: "unfinished-content", pattern: /\bTODO\b/g },
  { code: "phone-number", pattern: /(?<![\d.])(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/g },
  {
    code: "salary",
    pattern: /(?:薪资|薪酬|期望薪资|月薪)\s*[:：]?\s*\d+(?:\.\d+)?\s*(?:k|K|千|万|元)/g,
  },
  { code: "telephone-link", pattern: /tel:/gi },
];

function walk(directory, extensions) {
  if (!existsSync(directory)) return [];

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(fullPath, extensions);
    return extensions.has(path.extname(entry.name).toLowerCase()) ? [fullPath] : [];
  });
}

function locationsFor(text, matchIndex) {
  return text.slice(0, matchIndex).split("\n").length;
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

export function findPolicyViolations(text, relativePath) {
  const violations = [];

  for (const rule of forbiddenRules) {
    rule.pattern.lastIndex = 0;
    let match;
    while ((match = rule.pattern.exec(text)) !== null) {
      violations.push({
        code: rule.code,
        file: relativePath,
        line: locationsFor(text, match.index),
        value: match[0],
      });
    }
  }

  return violations;
}

export function validateReleaseEnvironment(environment = process.env) {
  const violations = [];
  const siteUrl = environment.SITE_URL;
  const expectedOrigin = "https://yzscodehub.github.io";

  if (!siteUrl) {
    violations.push({
      code: "site-url",
      file: "environment",
      line: 0,
      value: "SITE_URL is required",
    });
    return violations;
  }

  try {
    const parsed = new URL(siteUrl);
    if (parsed.origin !== expectedOrigin || parsed.pathname !== "/") {
      violations.push({ code: "site-url", file: "environment", line: 0, value: siteUrl });
    }
  } catch {
    violations.push({ code: "site-url", file: "environment", line: 0, value: siteUrl });
  }

  return violations;
}

export function validateReleaseStage(environment = process.env) {
  try {
    const features = resolveSiteFeatures(environment.SITE_STAGE);
    if (features.stage === "release") return [];
    return [
      {
        code: "stage",
        file: "environment",
        line: 0,
        value: "verify-release requires SITE_STAGE=release",
      },
    ];
  } catch (error) {
    return [
      {
        code: "stage",
        file: "environment",
        line: 0,
        value: error instanceof Error ? error.message : "invalid SITE_STAGE",
      },
    ];
  }
}

export function scanReleaseFiles(root = projectRoot) {
  const roots = [
    { directory: path.join(root, "src"), extensions: sourceExtensions },
    { directory: path.join(root, "dist"), extensions: renderedExtensions },
  ];

  return roots.flatMap(({ directory, extensions }) =>
    walk(directory, extensions).flatMap((file) => {
      const relativePath = path.relative(root, file).replaceAll(path.sep, "/");
      return findPolicyViolations(readFileSync(file, "utf8"), relativePath);
    }),
  );
}

export function validateReleaseArtifacts(root = projectRoot) {
  const violations = [];
  const expectedBase = "https://yzscodehub.github.io/graphics-portfolio/";
  const model = path.join(root, "public", "models", "neural-denoiser.onnx");
  const outputRoot = path.join(root, "dist");
  const robots = path.join(outputRoot, "robots.txt");
  const sitemap = path.join(outputRoot, "sitemap-index.xml");
  const rss = path.join(outputRoot, "rss.xml");
  const mediaManifest = path.join(root, "public", "media", "assets-manifest.json");
  const ogManifest = path.join(root, "public", "og", "manifest.json");
  if (!existsSync(model)) {
    violations.push({
      code: "missing-model",
      file: "public/models/neural-denoiser.onnx",
      line: 0,
      value: "reviewed ONNX model is required",
    });
  } else if (statSync(model).size > 5 * 1024 * 1024) {
    violations.push({
      code: "model-size",
      file: "public/models/neural-denoiser.onnx",
      line: 0,
      value: `${statSync(model).size} bytes`,
    });
  }

  if (!existsSync(outputRoot)) {
    violations.push({
      code: "missing-dist",
      file: "dist",
      line: 0,
      value: "run the release Astro build first",
    });
    return violations;
  }

  if (!existsSync(robots)) {
    violations.push({
      code: "missing-robots",
      file: "dist/robots.txt",
      line: 0,
      value: "release robots.txt is required",
    });
  } else {
    const robotsBody = readFileSync(robots, "utf8");
    if (!/^\s*allow:\s*\/\s*$/im.test(robotsBody) || /^\s*disallow:\s*\/\s*$/im.test(robotsBody)) {
      violations.push({
        code: "robots-policy",
        file: "dist/robots.txt",
        line: 0,
        value: "release must allow crawling",
      });
    }
    if (
      !robotsBody.includes(
        "Sitemap: https://yzscodehub.github.io/graphics-portfolio/sitemap-index.xml",
      )
    ) {
      violations.push({
        code: "robots-sitemap",
        file: "dist/robots.txt",
        line: 0,
        value: "release robots.txt must link the HTTPS sitemap",
      });
    }
  }

  for (const [code, file] of [
    ["missing-sitemap", sitemap],
    ["missing-rss", rss],
    ["missing-media-manifest", mediaManifest],
    ["missing-og-manifest", ogManifest],
  ]) {
    if (!existsSync(file)) {
      violations.push({
        code,
        file: path.relative(root, file).replaceAll(path.sep, "/"),
        line: 0,
        value: "required for the indexed release stage",
      });
    }
  }

  if (existsSync(mediaManifest)) {
    const manifest = JSON.parse(readFileSync(mediaManifest, "utf8"));
    if (!Array.isArray(manifest.assets) || manifest.assets.length === 0)
      violations.push({
        code: "empty-media-manifest",
        file: "public/media/assets-manifest.json",
        line: 0,
        value: "release media manifest must contain reviewed assets",
      });
    const environmentIds = new Set((manifest.environments ?? []).map((entry) => entry.id));
    if (environmentIds.size === 0)
      violations.push({
        code: "missing-evidence-environment",
        file: "public/media/assets-manifest.json",
        line: 0,
        value: "EvidenceManifest must record capture/generation environments",
      });
    for (const [role, expected] of Object.entries({
      "demo-poster": 7,
      "project-cover": 4,
      "project-architecture": 4,
      "demo-runtime-capture": 4,
    })) {
      const actual = (manifest.assets ?? []).filter((asset) => asset.role === role).length;
      if (actual !== expected)
        violations.push({
          code: "media-inventory",
          file: "public/media/assets-manifest.json",
          line: 0,
          value: `${role}: expected ${expected}, found ${actual}`,
        });
    }
    for (const asset of manifest.assets ?? []) {
      const file = path.join(root, asset.path);
      if (!existsSync(file)) {
        violations.push({
          code: "missing-media",
          file: asset.path,
          line: 0,
          value: "manifest asset missing",
        });
        continue;
      }
      if (asset.license !== "self-authored" || asset.owner !== "yzscodehub")
        violations.push({
          code: "media-license",
          file: asset.path,
          line: 0,
          value: "release media must be self-authored and attributed",
        });
      if (statSync(file).size !== asset.bytes)
        violations.push({
          code: "media-size-manifest",
          file: asset.path,
          line: 0,
          value: "recorded byte size does not match",
        });
      if (asset.sha256 !== sha256(file))
        violations.push({
          code: "media-hash-manifest",
          file: asset.path,
          line: 0,
          value: "recorded SHA-256 does not match",
        });
      if (!(asset.width > 0) || !(asset.height > 0))
        violations.push({
          code: "media-dimensions-manifest",
          file: asset.path,
          line: 0,
          value: "positive width and height are required",
        });
      if (!environmentIds.has(asset.environment))
        violations.push({
          code: "media-environment-manifest",
          file: asset.path,
          line: 0,
          value: "asset must reference a declared evidence environment",
        });
    }
  }

  if (existsSync(ogManifest)) {
    const manifest = JSON.parse(readFileSync(ogManifest, "utf8"));
    for (const fontSource of manifest.fontSources ?? [])
      if (!existsSync(path.join(root, fontSource)))
        violations.push({
          code: "missing-og-font",
          file: fontSource,
          line: 0,
          value: "embedded OG font source missing",
        });
    if (!Array.isArray(manifest.cards) || manifest.cards.length === 0)
      violations.push({
        code: "empty-og-manifest",
        file: "public/og/manifest.json",
        line: 0,
        value: "release OG manifest must contain generated cards",
      });
    if ((manifest.cards ?? []).length !== 18)
      violations.push({
        code: "og-inventory",
        file: "public/og/manifest.json",
        line: 0,
        value: `expected 18 cards, found ${(manifest.cards ?? []).length}`,
      });
    for (const card of manifest.cards ?? []) {
      const file = path.join(root, "public", card.path.replace(/^\//, ""));
      if (!existsSync(file))
        violations.push({
          code: "missing-og-card",
          file: card.path,
          line: 0,
          value: "manifest OG card missing",
        });
      else {
        if (card.bytes !== statSync(file).size || card.sha256 !== sha256(file))
          violations.push({
            code: "og-evidence-manifest",
            file: card.path,
            line: 0,
            value: "OG bytes/hash do not match the generated card",
          });
        if (card.width !== 1200 || card.height !== 630)
          violations.push({
            code: "og-dimensions-manifest",
            file: card.path,
            line: 0,
            value: "OG cards must be 1200x630",
          });
      }
    }
  }

  for (const pdf of walk(outputRoot, new Set([".pdf"])))
    violations.push({
      code: "forbidden-pdf",
      file: path.relative(root, pdf).replaceAll(path.sep, "/"),
      line: 0,
      value: "release remains resume/PDF-free",
    });
  if (existsSync(path.join(outputRoot, "media", "placeholders")))
    violations.push({
      code: "placeholder-media-directory",
      file: "dist/media/placeholders",
      line: 0,
      value: "obsolete placeholder assets must not ship",
    });
  for (const resumePath of [
    path.join(outputRoot, "resume", "index.html"),
    path.join(outputRoot, "en", "resume", "index.html"),
  ])
    if (existsSync(resumePath))
      violations.push({
        code: "forbidden-resume-route",
        file: path.relative(root, resumePath).replaceAll(path.sep, "/"),
        line: 0,
        value: "release remains resume-free",
      });

  for (const [code, file] of [
    ["sitemap-base", sitemap],
    ["rss-base", rss],
  ]) {
    if (existsSync(file) && !readFileSync(file, "utf8").includes(expectedBase))
      violations.push({
        code,
        file: path.relative(root, file).replaceAll(path.sep, "/"),
        line: 0,
        value: `URLs must use ${expectedBase}`,
      });
  }

  for (const html of walk(outputRoot, new Set([".html"]))) {
    const source = readFileSync(html, "utf8");
    const relative = path.relative(root, html).replaceAll(path.sep, "/");
    const isNotFound = relative === "dist/404.html";
    if (/media\/placeholders\//i.test(source))
      violations.push({
        code: "placeholder-media",
        file: relative,
        line: 0,
        value: "release pages must use reviewed media assets",
      });
    if (!isNotFound && /<meta\s+name=["']robots["'][^>]*noindex/i.test(source))
      violations.push({
        code: "release-noindex",
        file: relative,
        line: 0,
        value: "indexed release pages must not emit noindex",
      });
    const canonical = source.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)/i)?.[1];
    if (!canonical?.startsWith(expectedBase))
      violations.push({
        code: "canonical-base",
        file: relative,
        line: 0,
        value: canonical ?? "missing canonical",
      });
    const ogUrl = source.match(/<meta\s+property=["']og:url["']\s+content=["']([^"']+)/i)?.[1];
    const ogImage = source.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)/i)?.[1];
    if (!ogUrl?.startsWith(expectedBase) || !ogImage?.startsWith(expectedBase))
      violations.push({
        code: "open-graph-base",
        file: relative,
        line: 0,
        value: "og:url and og:image must use the production base",
      });
    const requiresStructuredData =
      relative === "dist/index.html" ||
      relative === "dist/en/index.html" ||
      /dist\/(?:en\/)?about\/index\.html$/.test(relative) ||
      /dist\/(?:en\/)?(?:work|demos)\/[^/]+\/index\.html$/.test(relative) ||
      /dist\/writing\/[^/]+\/index\.html$/.test(relative);
    if (requiresStructuredData && !source.includes('type="application/ld+json"'))
      violations.push({
        code: "missing-json-ld",
        file: relative,
        line: 0,
        value: "structured content requires JSON-LD",
      });
    if (/WORK IN PROGRESS/i.test(source))
      violations.push({
        code: "release-wip",
        file: relative,
        line: 0,
        value: "release UI must not retain the preview WIP badge",
      });
    if (/href=["'][^"']*\/resume\//i.test(source))
      violations.push({
        code: "resume-link",
        file: relative,
        line: 0,
        value: "release remains resume-free",
      });
    for (const contact of source.matchAll(/<a\b[^>]*data-contact-link[^>]*>/gi)) {
      if (!/href=["']https:\/\/github\.com\/yzscodehub["']/i.test(contact[0]))
        violations.push({
          code: "contact-policy",
          file: relative,
          line: 0,
          value: "contact controls must remain GitHub-only",
        });
    }
  }

  return violations;
}

function main(root = projectRoot) {
  const violations = [
    ...validateReleaseEnvironment(),
    ...validateReleaseStage(),
    ...validateReleaseArtifacts(root),
    ...scanReleaseFiles(root),
  ];
  if (violations.length === 0) {
    console.log("Release privacy and placeholder checks passed.");
    return;
  }

  console.error("Release validation failed:");
  for (const violation of violations) {
    const location = violation.line > 0 ? `:${violation.line}` : "";
    console.error(`- [${violation.code}] ${violation.file}${location} (${violation.value})`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2] ? path.resolve(process.argv[2]) : projectRoot);
}
