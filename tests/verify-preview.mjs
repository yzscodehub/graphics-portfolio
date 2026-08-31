import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { resolveSiteFeatures } from "../src/data/site-stage.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceExtensions = new Set([".astro", ".css", ".html", ".json", ".md", ".mdx", ".ts"]);
const textExtensions = new Set([".html", ".json", ".txt", ".xml"]);
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

const previewRules = [
  { code: "public-email-placeholder", pattern: /PUBLIC_EMAIL/gi },
  { code: "unfinished-content", pattern: /\bTODO\b/g },
  {
    code: "phone-number",
    pattern: /(?<![\d.])(?:\+?86[-\s]?)?1[3-9](?:[-\s]?\d){9}(?!\d)/g,
  },
  {
    code: "salary",
    pattern:
      /(?:期望\s*薪资|薪资|月薪|salary|compensation)\s*[:：]?\s*(?:¥|rmb|cny)?\s*\d+(?:[,.]\d+)?\s*(?:k|w|万|元|\/\s*(?:month|mo|月))?/giu,
  },
  { code: "telephone-link", pattern: /tel:/gi },
  { code: "email-link", pattern: /mailto:/gi },
  {
    code: "email-address",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  },
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

function walkAll(directory) {
  if (!existsSync(directory)) return [];

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walkAll(fullPath) : [fullPath];
  });
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function validateReviewedModelArtifacts(root, violations) {
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

function lineFor(text, index) {
  return text.slice(0, index).split("\n").length;
}

function isInsideHexDigest(text, match) {
  if (!/^[a-f\d]+$/i.test(match[0])) return false;
  let start = match.index;
  let end = match.index + match[0].length;
  while (start > 0 && /[a-f\d]/i.test(text[start - 1])) start -= 1;
  while (end < text.length && /[a-f\d]/i.test(text[end])) end += 1;
  return end - start >= 32;
}

export function findPreviewPolicyViolations(text, relativePath) {
  const violations = [];

  for (const rule of previewRules) {
    rule.pattern.lastIndex = 0;
    let match;
    while ((match = rule.pattern.exec(text)) !== null) {
      if (rule.code === "phone-number" && isInsideHexDigest(text, match)) continue;
      violations.push({
        code: rule.code,
        file: relativePath,
        line: lineFor(text, match.index),
        value: match[0],
      });
    }
  }

  return violations;
}

export function validatePreviewStage(environment = process.env) {
  try {
    const features = resolveSiteFeatures(environment.SITE_STAGE);
    if (features.stage === "preview") return [];
    return [
      {
        code: "stage",
        file: "environment",
        line: 0,
        value: "verify-preview requires SITE_STAGE=preview",
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

export function validatePreviewArtifacts(root = projectRoot) {
  const violations = [];
  const outputRoot = path.join(root, "dist");
  const robots = path.join(outputRoot, "robots.txt");

  validateReviewedModelArtifacts(root, violations);

  if (!existsSync(outputRoot)) {
    violations.push({
      code: "missing-dist",
      file: "dist",
      line: 0,
      value: "run astro build first",
    });
    return violations;
  }

  const prohibitedPaths = ["resume", path.join("en", "resume")];
  for (const relativePath of prohibitedPaths) {
    if (existsSync(path.join(outputRoot, relativePath))) {
      violations.push({
        code: "resume-route",
        file: path.join("dist", relativePath).replaceAll(path.sep, "/"),
        line: 0,
        value: "resume routes are deferred during public preview",
      });
    }
  }

  for (const file of walkAll(outputRoot)) {
    const relativePath = path.relative(root, file).replaceAll(path.sep, "/");
    if (path.extname(file).toLowerCase() === ".pdf") {
      violations.push({
        code: "preview-pdf",
        file: relativePath,
        line: 0,
        value: "PDF artifacts are deferred during public preview",
      });
    }
    if (/^sitemap(?:-|\.)/i.test(path.basename(file))) {
      violations.push({
        code: "preview-sitemap",
        file: relativePath,
        line: 0,
        value: "sitemaps are reserved for the indexed release stage",
      });
    }
  }

  if (existsSync(path.join(outputRoot, "media", "placeholders")))
    violations.push({
      code: "placeholder-media-directory",
      file: "dist/media/placeholders",
      line: 0,
      value: "obsolete placeholder assets must not ship",
    });

  if (!existsSync(robots)) {
    violations.push({
      code: "missing-robots",
      file: "dist/robots.txt",
      line: 0,
      value: "required",
    });
  } else if (!/^\s*disallow:\s*\/\s*$/im.test(readFileSync(robots, "utf8"))) {
    violations.push({
      code: "robots-policy",
      file: "dist/robots.txt",
      line: 0,
      value: "must include Disallow: /",
    });
  }

  for (const htmlFile of walk(outputRoot, new Set([".html"]))) {
    const html = readFileSync(htmlFile, "utf8");
    const relativePath = path.relative(root, htmlFile).replaceAll(path.sep, "/");
    const isNotFound = relativePath === "dist/404.html";
    if (!/<meta\s+name=["']robots["']\s+content=["']noindex,nofollow["']\s*\/?\s*>/i.test(html)) {
      violations.push({
        code: "missing-noindex",
        file: relativePath,
        line: 0,
        value: "preview pages must opt out of indexing",
      });
    }
    if (
      isNotFound &&
      (/<link\s+rel=["']canonical["']/i.test(html) ||
        /<meta\s+property=["']og:(?:url|image)["']/i.test(html))
    ) {
      violations.push({
        code: "not-found-seo-metadata",
        file: relativePath,
        line: 0,
        value: "404 must not publish canonical or Open Graph URL/image metadata",
      });
    }
    for (const contact of html.matchAll(/<a\b[^>]*data-contact-link[^>]*>/gi))
      if (!/href=["']https:\/\/github\.com\/yzscodehub["']/i.test(contact[0]))
        violations.push({
          code: "contact-policy",
          file: relativePath,
          line: 0,
          value: "contact controls must remain GitHub-only",
        });
  }

  return violations;
}

export function findTrackedPreviewFileViolations(trackedPaths) {
  return trackedPaths
    .filter((relativePath) => path.extname(relativePath).toLowerCase() === ".pdf")
    .map((relativePath) => ({
      code: "tracked-preview-pdf",
      file: relativePath.replaceAll(path.sep, "/"),
      line: 0,
      value: "generated resume PDFs must remain untracked during preview",
    }));
}

export function validateTrackedPreviewFiles(root = projectRoot) {
  if (!existsSync(path.join(root, ".git"))) return [];

  try {
    const tracked = execFileSync(
      "git",
      ["-c", `safe.directory=${root.replaceAll("\\", "/")}`, "ls-files", "-z", "--", "*.pdf"],
      { cwd: root, encoding: "utf8" },
    )
      .split("\0")
      .filter(Boolean);
    return findTrackedPreviewFileViolations(tracked);
  } catch (error) {
    return [
      {
        code: "tracked-file-scan",
        file: ".git",
        line: 0,
        value: error instanceof Error ? error.message : "unable to inspect tracked preview files",
      },
    ];
  }
}

export function scanPreviewFiles(root = projectRoot) {
  const roots = [
    { directory: path.join(root, "src"), extensions: sourceExtensions },
    { directory: path.join(root, "dist"), extensions: textExtensions },
  ];

  return roots.flatMap(({ directory, extensions }) =>
    walk(directory, extensions).flatMap((file) => {
      const relativePath = path.relative(root, file).replaceAll(path.sep, "/");
      return findPreviewPolicyViolations(readFileSync(file, "utf8"), relativePath);
    }),
  );
}

function main(root = projectRoot) {
  const violations = [
    ...validatePreviewStage(),
    ...validatePreviewArtifacts(root),
    ...validateTrackedPreviewFiles(root),
    ...scanPreviewFiles(root),
  ];
  if (violations.length === 0) {
    console.log("Preview privacy and artifact checks passed.");
    return;
  }

  console.error("Preview validation failed:");
  for (const violation of violations) {
    const location = violation.line > 0 ? `:${violation.line}` : "";
    console.error(`- [${violation.code}] ${violation.file}${location} (${violation.value})`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2] ? path.resolve(process.argv[2]) : projectRoot);
}
