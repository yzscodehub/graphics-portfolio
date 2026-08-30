import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentRoot = path.join(projectRoot, "src", "content");
const expectedChineseEntries = {
  projects: 4,
  demos: 7,
  writing: 10,
};
const writingModules = new Set([
  "rendering",
  "engine-systems",
  "gpu-compute",
  "ray-tracing",
  "debugging",
  "neural-graphics",
  "multimedia",
]);
const expectedWritingModules = new Map([
  ["rendering", { order: 1, articles: 2 }],
  ["engine-systems", { order: 2, articles: 2 }],
  ["gpu-compute", { order: 3, articles: 2 }],
  ["ray-tracing", { order: 4, articles: 1 }],
  ["debugging", { order: 5, articles: 1 }],
  ["neural-graphics", { order: 6, articles: 1 }],
  ["multimedia", { order: 7, articles: 1 }],
]);

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return /\.mdx?$/.test(entry.name) ? [fullPath] : [];
  });
}

function parseFrontmatter(source, file) {
  const match = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!match) throw new Error(`${file} is missing YAML frontmatter.`);

  const values = {};
  let activeArray;
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (field) {
      const value = field[2].replace(/^['"]|['"]$/g, "");
      activeArray = value === "" ? field[1] : undefined;
      values[field[1]] = value === "" || value === "[]" ? [] : value;
      continue;
    }
    const item = activeArray ? line.match(/^\s{2}-\s+(.+)$/) : undefined;
    if (item && Array.isArray(values[activeArray]))
      values[activeArray].push(item[1].replace(/^['"]|['"]$/g, ""));
  }
  return values;
}

function validateCollection(name) {
  const files = walk(path.join(contentRoot, name));
  const entries = files.map((file) => {
    const source = readFileSync(file, "utf8");
    return {
      file: path.relative(projectRoot, file).replaceAll(path.sep, "/"),
      meta: parseFrontmatter(source, file),
      source,
    };
  });
  const errors = [];
  const seen = new Set();

  for (const entry of entries) {
    const { locale, routeSlug, translationKey, draft } = entry.meta;
    if (locale !== "zh-CN" && locale !== "en") {
      errors.push(`${entry.file}: locale must be zh-CN or en.`);
    }
    if (!translationKey) {
      errors.push(`${entry.file}: translationKey is required.`);
    }
    if (name !== "experience" && !routeSlug) {
      errors.push(`${entry.file}: routeSlug is required.`);
    }
    if (locale && translationKey) {
      const identity = `${locale}:${translationKey}`;
      if (seen.has(identity)) errors.push(`${entry.file}: duplicate ${identity}.`);
      seen.add(identity);
    }
    if (
      name === "writing" &&
      draft !== "true" &&
      (!entry.meta.englishTitle || !entry.meta.englishDescription)
    ) {
      errors.push(`${entry.file}: published writing needs englishTitle and englishDescription.`);
    }
    if (name === "writing" && draft !== "true") {
      if (!writingModules.has(entry.meta.module))
        errors.push(`${entry.file}: unknown writing module ${entry.meta.module || "<missing>"}.`);
      if (!/^\d+$/.test(entry.meta.moduleOrder ?? ""))
        errors.push(`${entry.file}: moduleOrder must be a positive integer.`);
      if (!/^\d+$/.test(entry.meta.articleOrder ?? ""))
        errors.push(`${entry.file}: articleOrder must be a positive integer.`);
      if (!new Set(["foundation", "intermediate", "advanced"]).has(entry.meta.level))
        errors.push(`${entry.file}: invalid or missing level.`);
      if (!Array.isArray(entry.meta.prerequisites) || entry.meta.prerequisites.length < 2)
        errors.push(`${entry.file}: at least two prerequisites are required.`);
      if (!Array.isArray(entry.meta.learningOutcomes) || entry.meta.learningOutcomes.length < 3)
        errors.push(`${entry.file}: at least three learning outcomes are required.`);
      for (const field of ["relatedArticles", "relatedProjects", "relatedDemos"])
        if (!Array.isArray(entry.meta[field]))
          errors.push(`${entry.file}: ${field} must be an array.`);
      const expectedModule = expectedWritingModules.get(entry.meta.module);
      if (expectedModule && Number(entry.meta.moduleOrder) !== expectedModule.order)
        errors.push(
          `${entry.file}: moduleOrder must be ${expectedModule.order} for ${entry.meta.module}.`,
        );
      if (!entry.meta.publishedAt || !entry.meta.updatedAt)
        errors.push(`${entry.file}: publishedAt and updatedAt are required.`);
      const readingMinutes = Number(entry.meta.readingMinutes);
      if (!Number.isInteger(readingMinutes) || readingMinutes < 12 || readingMinutes > 25)
        errors.push(`${entry.file}: readingMinutes must be an integer between 12 and 25.`);
      const body = entry.source.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*/, "");
      if (Buffer.byteLength(body, "utf8") < 6_000)
        errors.push(`${entry.file}: article body must contain at least 6000 UTF-8 bytes.`);
      if ((body.match(/^## /gm) ?? []).length < 7)
        errors.push(`${entry.file}: article needs at least seven H2 sections.`);
      if ((body.match(/^```/gm) ?? []).length < 2)
        errors.push(`${entry.file}: article needs at least one fenced diagram or code block.`);
      if (!body.includes("可复现"))
        errors.push(`${entry.file}: article needs a reproducible experiment.`);
      if (!/(?:边界|限制|检查表)/.test(body))
        errors.push(`${entry.file}: article needs an explicit boundary, limitation, or checklist.`);
    }
  }

  return { entries, errors };
}

function main() {
  const errors = [];
  const collections = {};

  for (const [collection, expectedCount] of Object.entries(expectedChineseEntries)) {
    const result = validateCollection(collection);
    collections[collection] = result;
    errors.push(...result.errors);
    const publishedChineseKeys = new Set(
      result.entries
        .filter(({ meta }) => meta.locale === "zh-CN" && meta.draft !== "true")
        .map(({ meta }) => meta.translationKey),
    );
    if (publishedChineseKeys.size !== expectedCount) {
      errors.push(
        `${collection}: expected ${expectedCount} published zh-CN entries, found ${publishedChineseKeys.size}.`,
      );
    }
    if (collection === "projects" || collection === "demos") {
      const publishedEnglishKeys = new Set(
        result.entries
          .filter(({ meta }) => meta.locale === "en" && meta.draft !== "true")
          .map(({ meta }) => meta.translationKey),
      );
      const missingEnglish = [...publishedChineseKeys].filter(
        (key) => !publishedEnglishKeys.has(key),
      );
      const missingChinese = [...publishedEnglishKeys].filter(
        (key) => !publishedChineseKeys.has(key),
      );
      if (
        publishedEnglishKeys.size !== expectedCount ||
        missingEnglish.length ||
        missingChinese.length
      )
        errors.push(
          `${collection}: zh-CN/en translationKey sets differ (missing en: ${missingEnglish.join(", ") || "none"}; missing zh-CN: ${missingChinese.join(", ") || "none"}).`,
        );
    }
    if (collection === "demos")
      for (const { file, meta } of result.entries.filter(({ meta }) => meta.draft !== "true")) {
        if (meta.status !== "completed" || meta.maturity !== "completed")
          errors.push(`${file}: published Demo status and maturity must both be completed.`);
        if (/media\/placeholders\//.test(meta.fallbackImage ?? ""))
          errors.push(`${file}: published Demo fallbackImage must be reviewed media.`);
      }
  }

  const projectSlugs = new Set(
    collections.projects.entries
      .filter(({ meta }) => meta.locale === "zh-CN" && meta.draft !== "true")
      .map(({ meta }) => meta.routeSlug),
  );
  const demoSlugs = new Set(
    collections.demos.entries
      .filter(({ meta }) => meta.locale === "zh-CN" && meta.draft !== "true")
      .map(({ meta }) => meta.routeSlug),
  );
  const articleSlugs = new Set(
    collections.writing.entries
      .filter(({ meta }) => meta.locale === "zh-CN" && meta.draft !== "true")
      .map(({ meta }) => meta.routeSlug),
  );
  for (const { file, meta } of collections.projects.entries.filter(
    ({ meta }) => meta.draft !== "true",
  )) {
    for (const slug of meta.demoSlugs ?? [])
      if (!demoSlugs.has(slug)) errors.push(`${file}: unknown related Demo ${slug}.`);
    for (const slug of meta.articleSlugs ?? [])
      if (!articleSlugs.has(slug)) errors.push(`${file}: unknown related article ${slug}.`);
  }
  for (const { file, meta } of collections.demos.entries.filter(
    ({ meta }) => meta.draft !== "true",
  )) {
    for (const slug of meta.relatedProjects ?? [])
      if (!projectSlugs.has(slug)) errors.push(`${file}: unknown related project ${slug}.`);
    for (const slug of meta.relatedArticles ?? [])
      if (!articleSlugs.has(slug)) errors.push(`${file}: unknown related article ${slug}.`);
  }
  const writingOrder = new Set();
  const writingModuleCounts = new Map();
  for (const { file, meta } of collections.writing.entries.filter(
    ({ meta }) => meta.draft !== "true",
  )) {
    const orderKey = `${meta.module}:${meta.articleOrder}`;
    if (writingOrder.has(orderKey)) errors.push(`${file}: duplicate writing order ${orderKey}.`);
    writingOrder.add(orderKey);
    writingModuleCounts.set(meta.module, (writingModuleCounts.get(meta.module) ?? 0) + 1);
    for (const slug of meta.relatedProjects ?? [])
      if (!projectSlugs.has(slug)) errors.push(`${file}: unknown related project ${slug}.`);
    for (const slug of meta.relatedDemos ?? [])
      if (!demoSlugs.has(slug)) errors.push(`${file}: unknown related Demo ${slug}.`);
    for (const slug of meta.relatedArticles ?? [])
      if (!articleSlugs.has(slug)) errors.push(`${file}: unknown related article ${slug}.`);
  }
  for (const [module, contract] of expectedWritingModules) {
    const actual = writingModuleCounts.get(module) ?? 0;
    if (actual !== contract.articles)
      errors.push(`writing: ${module} expected ${contract.articles} articles, found ${actual}.`);
  }

  const experience = validateCollection("experience");
  errors.push(...experience.errors);
  if (experience.entries.length === 0)
    errors.push("experience: at least one anonymous experience entry is required.");

  if (errors.length === 0) {
    console.log("Content contract checks passed.");
    return;
  }

  console.error("Content contract validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
}

main();
