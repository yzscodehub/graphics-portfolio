import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentRoot = path.join(projectRoot, "src", "content");
const expectedChineseEntries = {
  projects: 4,
  demos: 7,
  writing: 6,
};

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
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!field) continue;
    values[field[1]] = field[2].replace(/^['"]|['"]$/g, "");
  }
  return values;
}

function validateCollection(name) {
  const files = walk(path.join(contentRoot, name));
  const entries = files.map((file) => ({
    file: path.relative(projectRoot, file).replaceAll(path.sep, "/"),
    meta: parseFrontmatter(readFileSync(file, "utf8"), file),
  }));
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
  }

  return { entries, errors };
}

function main() {
  const errors = [];

  for (const [collection, expectedCount] of Object.entries(expectedChineseEntries)) {
    const result = validateCollection(collection);
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
