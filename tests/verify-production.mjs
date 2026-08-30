import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

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
  { code: "unfinished-content", pattern: /\bTODO\b/g },
  { code: "phone-number", pattern: /(?<![\d.])(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/g },
  {
    code: "salary",
    pattern: /(?:薪资|薪酬|期望薪资|月薪)\s*[:：]?\s*\d+(?:\.\d+)?\s*(?:k|K|千|万|元)/g,
  },
  { code: "telephone-link", pattern: /tel:/gi },
  { code: "release-not-ready", pattern: /ready\s*:\s*false/g },
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
    if (parsed.protocol !== "https:" || parsed.hostname.endsWith(".invalid")) {
      violations.push({ code: "site-url", file: "environment", line: 0, value: siteUrl });
    }
  } catch {
    violations.push({ code: "site-url", file: "environment", line: 0, value: siteUrl });
  }

  return violations;
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
  const model = path.join(root, "public", "models", "neural-denoiser.onnx");
  const resumes = [
    path.join(root, "public", "resume", "resume-zh-CN.pdf"),
    path.join(root, "public", "resume", "resume-en.pdf"),
  ];
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
  for (const resume of resumes) {
    if (!existsSync(resume))
      violations.push({
        code: "missing-resume",
        file: path.relative(root, resume),
        line: 0,
        value: "bilingual PDF is required",
      });
  }
  return violations;
}

function main(root = projectRoot) {
  const violations = [
    ...validateReleaseEnvironment(),
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
