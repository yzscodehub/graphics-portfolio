import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveSiteFeatures, resolveSourceRef } from "../src/data/site-stage.mjs";

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
const labeledFieldDecorators = `(?:["'*\\x60]|&quot;)*`;

function labeledFieldRule(code, labels) {
  const field = String.raw`(?:^|[\n\r,{])\s*${labeledFieldDecorators}\s*(?:${labels})\s*${labeledFieldDecorators}\s*[:：]\s*${labeledFieldDecorators}\s*[^\n\r,}<]{2,}`;
  const table = String.raw`<(?:dt|th|strong|b|span)[^>]*>\s*(?:${labels})\s*<\/[^>]+>\s*(?:[:：]\s*)?(?:<(?:dd|td|span)[^>]*>\s*)?[^<\n]{2,}`;
  return { code, pattern: new RegExp(`${field}|${table}`, "gimu") };
}

const privacyFieldRules = [
  {
    code: "prc-government-id",
    pattern:
      /(?<![\dA-Za-z])[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?![\dA-Za-z])/g,
  },
  labeledFieldRule(
    "legal-name-field",
    "真实\\s*姓名|法定\\s*姓名|姓名(?:全称)?|legal\\s*name|real\\s*name|full\\s*legal\\s*name",
  ),
  labeledFieldRule(
    "home-address-field",
    "家庭\\s*(?:住址|地址)|住宅\\s*地址|居住\\s*地址|详细\\s*住址|home\\s*address|residential\\s*address|street\\s*address|mailing\\s*address",
  ),
  labeledFieldRule(
    "employment-identity-field",
    "雇主(?:名称)?|任职\\s*公司|就职\\s*公司|所在\\s*公司|客户(?:名称|公司)?|内部\\s*项目(?:名称|代号|编号|代码)?|项目(?:代号|编号|代码)|employer(?:\\s*name)?|employing\\s*company|client(?:\\s*(?:name|company))?|customer(?:\\s*(?:name|company))?|internal\\s*project(?:\\s*(?:name|code|id))?|project\\s*(?:code|id)",
  ),
];

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
  ...privacyFieldRules,
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

import { validateNeuralModelV2Artifacts } from "./neural-model-gate.mjs";

function validateReviewedModelArtifacts(root, violations) {
  const neuralManifestPath = path.join(root, "public", "models", "neural-denoiser.manifest.json");
  if (
    existsSync(neuralManifestPath) &&
    /[\x22]version[\x22]\s*:\s*2/.test(readFileSync(neuralManifestPath, "utf8"))
  ) {
    validateNeuralModelV2Artifacts(root, violations, true);
    return;
  }
  const modelRoot = path.join(root, "public", "models");
  const model = path.join(modelRoot, "neural-denoiser.onnx");
  const manifestPath = path.join(modelRoot, "neural-denoiser.manifest.json");
  if (!existsSync(manifestPath)) {
    violations.push({
      code: "missing-model-manifest",
      file: "public/models/neural-denoiser.manifest.json",
      line: 0,
      value: "reviewed ONNX manifest is required",
    });
    return;
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    violations.push({
      code: "model-manifest-json",
      file: "public/models/neural-denoiser.manifest.json",
      line: 0,
      value: "manifest must be valid JSON",
    });
    return;
  }
  const modelEntry = manifest?.model;
  const heldoutEntry = manifest?.heldoutManifest;
  const validTensor = (tensor, name) =>
    tensor?.name === name &&
    tensor?.dtype === "float32" &&
    tensor?.layout === "NCHW" &&
    tensor?.range === "[0,1]" &&
    JSON.stringify(tensor?.shape) === JSON.stringify([1, 3, 256, 256]);
  if (
    manifest?.version !== 1 ||
    modelEntry?.file !== "neural-denoiser.onnx" ||
    modelEntry?.format !== "onnx" ||
    modelEntry?.opset !== 17 ||
    !validTensor(modelEntry?.input, "noisy_rgb") ||
    !validTensor(modelEntry?.output, "denoised_rgb") ||
    heldoutEntry?.file !== "heldout/manifest.json"
  ) {
    violations.push({
      code: "model-manifest-contract",
      file: "public/models/neural-denoiser.manifest.json",
      line: 0,
      value: "model, tensor, and held-out contracts must match the reviewed artifact",
    });
    return;
  }
  for (const [entry, file, code] of [
    [modelEntry, model, "model-artifact"],
    [heldoutEntry, path.join(modelRoot, heldoutEntry.file), "heldout-manifest-artifact"],
  ]) {
    if (!existsSync(file)) {
      violations.push({
        code: `missing-${code}`,
        file: path.relative(root, file),
        line: 0,
        value: "artifact missing",
      });
    } else if (
      !Number.isSafeInteger(entry?.bytes) ||
      entry.bytes <= 0 ||
      statSync(file).size !== entry.bytes ||
      !/^[a-f0-9]{64}$/i.test(entry?.sha256 ?? "") ||
      sha256(file) !== entry.sha256
    ) {
      violations.push({
        code: `${code}-hash`,
        file: path.relative(root, file),
        line: 0,
        value: "bytes or SHA-256 mismatch",
      });
    }
  }
  if (existsSync(model) && statSync(model).size > 5 * 1024 * 1024) {
    violations.push({
      code: "model-size",
      file: "public/models/neural-denoiser.onnx",
      line: 0,
      value: `${statSync(model).size} bytes`,
    });
  }
}

function isInsideHexDigest(text, match) {
  if (!/^[a-f\d]+$/i.test(match[0])) return false;
  let start = match.index;
  let end = match.index + match[0].length;
  while (start > 0 && /[a-f\d]/i.test(text[start - 1])) start -= 1;
  while (end < text.length && /[a-f\d]/i.test(text[end])) end += 1;
  return end - start >= 32;
}

export function findPolicyViolations(text, relativePath) {
  const violations = [];

  for (const rule of forbiddenRules) {
    rule.pattern.lastIndex = 0;
    let match;
    while ((match = rule.pattern.exec(text)) !== null) {
      if (rule.code === "phone-number" && isInsideHexDigest(text, match)) continue;
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

export function validateRenderingReleaseReadiness(root = projectRoot) {
  const violations = [];
  const manifestPath = path.join(root, "public", "assets", "rendering", "manifest.json");
  const sourceLockPath = path.join(root, "public", "assets", "rendering", "sources.lock.json");
  const runtimePath = path.join(root, "src", "demos", "research-courtyard", "scene.ts");
  const assetRoot = path.join(root, "public", "assets", "rendering");
  const digestPattern = /^[a-f0-9]{64}$/;

  if (!existsSync(manifestPath) || !existsSync(sourceLockPath)) {
    return [
      {
        code: "rendering-assets-not-reviewed",
        file: "public/assets/rendering",
        line: 0,
        value: "release requires the rendering asset manifest and reviewed source lock",
      },
    ];
  }

  let manifest;
  let sourceLock;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    sourceLock = JSON.parse(readFileSync(sourceLockPath, "utf8"));
  } catch {
    return [
      {
        code: "rendering-assets-not-reviewed",
        file: "public/assets/rendering",
        line: 0,
        value: "rendering asset manifests must be valid JSON",
      },
    ];
  }

  const courtyard = manifest.assets?.find((asset) => asset.id === "research-courtyard");
  const courtyardFile =
    typeof courtyard?.path === "string" ? path.join(root, courtyard.path) : undefined;
  let courtyardPack;
  if (courtyardFile && existsSync(courtyardFile)) {
    try {
      courtyardPack = JSON.parse(readFileSync(courtyardFile, "utf8"));
    } catch {
      courtyardPack = undefined;
    }
  }

  if (
    manifest.status !== "reviewed" ||
    String(manifest.generatedBy ?? "").includes("placeholder") ||
    String(courtyard?.role ?? "").includes("placeholder") ||
    courtyardPack?.placeholder !== false
  )
    violations.push({
      code: "rendering-assets-not-reviewed",
      file: "public/assets/rendering/manifest.json",
      line: 0,
      value: "Research Courtyard still uses the procedural placeholder pack",
    });

  const incompleteFiles = (sourceLock.sources ?? []).flatMap((source) =>
    (source.files ?? []).filter(
      (file) =>
        !/^https:\/\/dl\.polyhaven\.org\/file\//.test(file.directUrl ?? "") ||
        !digestPattern.test(file.sha256 ?? "") ||
        file.status !== "reviewed",
    ),
  );
  const missingSourceMetadata = (sourceLock.sources ?? []).some(
    (source) =>
      !Array.isArray(source.authors) ||
      source.authors.length === 0 ||
      source.license !== "CC0" ||
      !Array.isArray(source.files) ||
      source.files.length === 0,
  );
  if (
    sourceLock.version !== 2 ||
    sourceLock.policy?.downloaded !== true ||
    sourceLock.policy?.stage !== "integrated" ||
    missingSourceMetadata ||
    incompleteFiles.length > 0
  )
    violations.push({
      code: "rendering-source-lock-not-reviewed",
      file: "public/assets/rendering/sources.lock.json",
      line: 0,
      value: `${incompleteFiles.length} selected source files still lack reviewed SHA-256 state`,
    });

  const renderingFiles = walk(assetRoot, new Set([".ktx2", ".webp"]));
  const hasKtx2 = renderingFiles.some((file) => path.extname(file).toLowerCase() === ".ktx2");
  const hasWebp = renderingFiles.some((file) => path.extname(file).toLowerCase() === ".webp");
  if (!hasKtx2 || !hasWebp)
    violations.push({
      code: "rendering-texture-fallback-pair",
      file: "public/assets/rendering",
      line: 0,
      value: "release requires committed KTX2 textures and WebP fallbacks",
    });

  if (
    !existsSync(runtimePath) ||
    /buildProceduralResearchCourtyard|source:\s*["']procedural["']/.test(
      readFileSync(runtimePath, "utf8"),
    )
  )
    violations.push({
      code: "rendering-courtyard-runtime-placeholder",
      file: "src/demos/research-courtyard/scene.ts",
      line: 0,
      value: "release runtime must consume the reviewed packed scene rather than procedural boxes",
    });

  return violations;
}

export function validateRenderingAcceptanceEvidence(root = projectRoot) {
  const relative = "public/evidence/rendering-v2-acceptance.json";
  const file = path.join(root, relative);
  if (!existsSync(file))
    return [
      {
        code: "high-end-rendering-evidence-missing",
        file: relative,
        line: 0,
        value: "release requires a reviewed RTX 4070-class WebGPU acceptance manifest",
      },
    ];

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return [
      {
        code: "high-end-rendering-evidence-invalid",
        file: relative,
        line: 0,
        value: "acceptance manifest must be valid JSON",
      },
    ];
  }

  if (manifest.status !== "reviewed")
    return [
      {
        code: "high-end-rendering-evidence-pending",
        file: relative,
        line: 0,
        value: "real Windows 11 / RTX 4070-class Chromium WebGPU review is still pending",
      },
    ];

  const violations = [];
  const target = manifest.target;
  if (
    manifest.version !== 1 ||
    target?.os !== "Windows 11" ||
    target?.adapterClass !== "NVIDIA RTX 4070 class" ||
    target?.browser !== "Chromium Stable" ||
    target?.viewportWidth !== 1920 ||
    target?.viewportHeight !== 1080 ||
    target?.dpr !== 1
  )
    violations.push({
      code: "high-end-rendering-target",
      file: relative,
      line: 0,
      value: "acceptance target drifted from the fixed Windows 11 / RTX 4070-class contract",
    });

  const run = manifest.reviewedRun;
  const capturePath =
    typeof run?.evidencePath === "string" ? path.join(root, run.evidencePath) : undefined;
  if (
    run?.os !== "Windows 11" ||
    !/RTX\s*4070/i.test(run?.adapter ?? "") ||
    run?.browser !== "Chromium Stable" ||
    typeof run?.browserVersion !== "string" ||
    run.browserVersion.length === 0 ||
    run?.viewportWidth !== 1920 ||
    run?.viewportHeight !== 1080 ||
    run?.dpr !== 1 ||
    typeof run?.reviewer !== "string" ||
    run.reviewer.length === 0 ||
    !/^\d{4}-\d{2}-\d{2}T/.test(run?.reviewedAt ?? "") ||
    !capturePath ||
    !existsSync(capturePath) ||
    !/^[a-f0-9]{64}$/.test(run?.evidenceSha256 ?? "") ||
    (capturePath && existsSync(capturePath) && sha256(capturePath) !== run.evidenceSha256)
  )
    violations.push({
      code: "high-end-rendering-run",
      file: relative,
      line: 0,
      value: "reviewed run identity, capture, or SHA-256 is incomplete",
    });

  const requiredSlugs = [
    "material-lighting",
    "clustered-lighting",
    "shadow-aa",
    "render-graph",
    "frame-inspector",
    "gpu-particles",
    "path-tracer",
    "neural-denoising",
  ];
  const entries = new Map((manifest.demos ?? []).map((entry) => [entry.slug, entry]));
  if (
    entries.size !== requiredSlugs.length ||
    requiredSlugs.some((slug) => !entries.has(slug)) ||
    [...entries.values()].some((entry) => entry.status !== "passed")
  )
    violations.push({
      code: "high-end-rendering-demo-inventory",
      file: relative,
      line: 0,
      value: "all eight Demo reviews must be present and passed",
    });

  const checks = [
    ["material-lighting", "fpsP50", (value) => value >= 60],
    ["material-lighting", "frameTimeP95Ms", (value) => value <= 22],
    ["clustered-lighting", "fpsP50", (value) => value >= 60],
    ["clustered-lighting", "frameTimeP95Ms", (value) => value <= 22],
    ["clustered-lighting", "cluster512Overflow", (value) => value === 0],
    ["shadow-aa", "fpsP50", (value) => value >= 60],
    ["shadow-aa", "frameTimeP95Ms", (value) => value <= 22],
    ["frame-inspector", "fpsP50", (value) => value >= 60],
    ["frame-inspector", "frameTimeP95Ms", (value) => value <= 22],
    ["gpu-particles", "instances100kFpsP50", (value) => value >= 60],
    ["gpu-particles", "particles250kFpsP50", (value) => value >= 60],
    ["path-tracer", "progressiveUpdatesPerSecond", (value) => value >= 30],
    ["neural-denoising", "webgpuP50Ms", (value) => value <= 20],
    ["neural-denoising", "webgpuP95Ms", (value) => value <= 30],
    ["neural-denoising", "wasmP50Ms", (value) => value <= 250],
  ];
  const numericFailure = checks.some(([slug, key, predicate]) => {
    const value = entries.get(slug)?.metrics?.[key];
    return typeof value !== "number" || !predicate(value);
  });
  if (
    numericFailure ||
    entries.get("render-graph")?.metrics?.functionalReview !== true ||
    entries.get("frame-inspector")?.metrics?.attachmentReadback !== true
  )
    violations.push({
      code: "high-end-rendering-thresholds",
      file: relative,
      line: 0,
      value: "one or more required high-end functional/performance thresholds are missing",
    });

  return violations;
}

export function validateDemoReleaseMaturity(root = projectRoot) {
  const demoRoot = path.join(root, "src", "content", "demos");
  if (!existsSync(demoRoot)) return [];
  const entries = walk(demoRoot, new Set([".md", ".mdx"])).flatMap((file) => {
    const source = readFileSync(file, "utf8");
    const frontmatter = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
    const field = (name) => frontmatter.match(new RegExp(`^${name}:\\s*(.+)$`, "m"))?.[1]?.trim();
    if (field("draft") === "true") return [];
    return [
      {
        file: path.relative(root, file).replaceAll(path.sep, "/"),
        slug: field("routeSlug"),
        locale: field("locale"),
        status: field("status"),
        maturity: field("maturity"),
      },
    ];
  });
  const slugs = new Set(entries.map((entry) => entry.slug));
  const incomplete = entries.filter(
    (entry) => entry.status !== "completed" || entry.maturity !== "completed",
  );
  if (entries.length === 16 && slugs.size === 8 && incomplete.length === 0) return [];
  return [
    {
      code: "demos-not-completed",
      file: "src/content/demos",
      line: 0,
      value:
        incomplete.length > 0
          ? `Release requires completed bilingual Demo entries; incomplete: ${[
              ...new Set(incomplete.map((entry) => entry.slug)),
            ].join(", ")}`
          : `expected 16 bilingual entries for 8 Demos, found ${entries.length}/${slugs.size}`,
    },
  ];
}

export function validateReleaseArtifacts(root = projectRoot) {
  const violations = [];
  const expectedBase = "https://yzscodehub.github.io/graphics-portfolio/";
  const expectedBaseUrl = new URL(expectedBase);
  const outputRoot = path.join(root, "dist");
  const robots = path.join(outputRoot, "robots.txt");
  const sitemap = path.join(outputRoot, "sitemap-index.xml");
  const rss = path.join(outputRoot, "rss.xml");
  const mediaManifest = path.join(root, "public", "media", "assets-manifest.json");
  const ogManifest = path.join(root, "public", "og", "manifest.json");
  const manifestOgPaths = new Set();
  const expectedSourceRef = resolveSourceRef(process.env.SOURCE_REF, "release");
  validateReviewedModelArtifacts(root, violations);
  violations.push(...validateRenderingReleaseReadiness(root));
  violations.push(...validateRenderingAcceptanceEvidence(root));
  violations.push(...validateDemoReleaseMaturity(root));

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
      "demo-poster": 8,
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
    if ((manifest.cards ?? []).length !== 25)
      violations.push({
        code: "og-inventory",
        file: "public/og/manifest.json",
        line: 0,
        value: `expected 25 cards, found ${(manifest.cards ?? []).length}`,
      });
    for (const card of manifest.cards ?? []) {
      if (typeof card.path === "string") manifestOgPaths.add(card.path);
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
    for (const sourceLink of source.matchAll(/<a\b[^>]*data-demo-source-link[^>]*>/gi)) {
      const href = sourceLink[0].match(/href=["']([^"']+)["']/i)?.[1] ?? "";
      if (!href.includes(`/blob/${expectedSourceRef}/src/demos/`))
        violations.push({
          code: "demo-source-ref",
          file: relative,
          line: 0,
          value: `Demo source links must use release ref ${expectedSourceRef}`,
        });
    }
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
    const ogUrl = source.match(/<meta\s+property=["']og:url["']\s+content=["']([^"']+)/i)?.[1];
    const ogImage = source.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)/i)?.[1];
    if (isNotFound) {
      if (canonical || ogUrl || ogImage)
        violations.push({
          code: "not-found-seo-metadata",
          file: relative,
          line: 0,
          value: "404 must not publish canonical or Open Graph URL/image metadata",
        });
    } else if (!canonical?.startsWith(expectedBase)) {
      violations.push({
        code: "canonical-base",
        file: relative,
        line: 0,
        value: canonical ?? "missing canonical",
      });
    }
    if (!isNotFound && (!ogUrl?.startsWith(expectedBase) || !ogImage?.startsWith(expectedBase)))
      violations.push({
        code: "open-graph-base",
        file: relative,
        line: 0,
        value: "og:url and og:image must use the production base",
      });
    if (!isNotFound && ogImage?.startsWith(expectedBase) && manifestOgPaths.size > 0) {
      const imageUrl = new URL(ogImage);
      const manifestPath = `/${imageUrl.pathname.slice(expectedBaseUrl.pathname.length)}`;
      const outputAsset = path.join(outputRoot, manifestPath.slice(1));
      if (!manifestOgPaths.has(manifestPath))
        violations.push({
          code: "og-page-manifest",
          file: relative,
          line: 0,
          value: `${manifestPath} is not listed in public/og/manifest.json`,
        });
      else if (!existsSync(outputAsset))
        violations.push({
          code: "og-page-asset",
          file: relative,
          line: 0,
          value: `${manifestPath} is missing from dist`,
        });
    }
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
