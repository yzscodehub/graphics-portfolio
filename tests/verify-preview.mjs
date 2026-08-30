import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceExtensions = new Set([".astro", ".css", ".html", ".json", ".md", ".mdx", ".ts"]);
const textExtensions = new Set([".html", ".json", ".txt", ".xml"]);
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

function lineFor(text, index) {
  return text.slice(0, index).split("\n").length;
}

export function findPreviewPolicyViolations(text, relativePath) {
  const violations = [];

  for (const rule of previewRules) {
    rule.pattern.lastIndex = 0;
    let match;
    while ((match = rule.pattern.exec(text)) !== null) {
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

export function validatePreviewArtifacts(root = projectRoot) {
  const violations = [];
  const outputRoot = path.join(root, "dist");
  const model = path.join(root, "public", "models", "neural-denoiser.onnx");
  const robots = path.join(outputRoot, "robots.txt");

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
    if (!/<meta\s+name=["']robots["']\s+content=["']noindex,nofollow["']\s*\/?\s*>/i.test(html)) {
      violations.push({
        code: "missing-noindex",
        file: path.relative(root, htmlFile).replaceAll(path.sep, "/"),
        line: 0,
        value: "preview pages must opt out of indexing",
      });
    }
  }

  return violations;
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
  const violations = [...validatePreviewArtifacts(root), ...scanPreviewFiles(root)];
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
