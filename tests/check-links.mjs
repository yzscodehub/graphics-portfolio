import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(projectRoot, "dist");
const projectBase = "/graphics-portfolio/";
const siteOrigins = new Set(["https://example.invalid", "https://yzscodehub.github.io"]);
if (process.env.SITE_URL) {
  try {
    siteOrigins.add(new URL(process.env.SITE_URL).origin);
  } catch {
    // The stage-specific verifier reports malformed SITE_URL values.
  }
}

function walk(directory, extensions = new Set([".html"])) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory()
      ? walk(fullPath, extensions)
      : extensions.has(path.extname(entry.name).toLowerCase())
        ? [fullPath]
        : [];
  });
}

function isNonWebReference(reference) {
  return /^(?:data|mailto|tel):/i.test(reference);
}

function publicUrlFor(sourceFile) {
  const relative = path.relative(distRoot, sourceFile).replaceAll(path.sep, "/");
  const route = relative.endsWith("/index.html")
    ? relative.slice(0, -"index.html".length)
    : relative === "index.html"
      ? ""
      : relative;
  return new URL(`${projectBase}${route}`, "https://example.invalid");
}

function resolveOutputFile(url) {
  const pathname = decodeURIComponent(url.pathname);
  if (!pathname.startsWith(projectBase)) return undefined;

  const target = path.join(distRoot, pathname.slice(projectBase.length));
  if (existsSync(target) && statSync(target).isFile()) return target;
  const index = path.join(target, "index.html");
  return existsSync(index) && statSync(index).isFile() ? index : undefined;
}

function containsFragment(target, hash) {
  if (!hash || path.extname(target).toLowerCase() !== ".html") return true;
  const fragment = decodeURIComponent(hash.slice(1));
  if (!fragment) return true;
  const html = readFileSync(target, "utf8");
  const anchors = new Set(
    [...html.matchAll(/\b(?:id|name)=["']([^"']+)["']/gi)].map((match) => match[1]),
  );
  return anchors.has(fragment);
}

function validateReference(reference, sourceFile) {
  if (isNonWebReference(reference)) return { valid: true };
  if (/^(?:java|vb)script:/i.test(reference)) {
    return { valid: false, reason: "executable URL schemes are forbidden" };
  }

  let resolved;
  try {
    resolved = new URL(reference, publicUrlFor(sourceFile));
  } catch {
    return { valid: false, reason: "malformed URL" };
  }

  if (!["http:", "https:"].includes(resolved.protocol)) return { valid: true };
  const explicitlyAbsolute = /^(?:https?:)?\/\//i.test(reference);
  if (explicitlyAbsolute && !siteOrigins.has(resolved.origin)) return { valid: true };

  const target = resolveOutputFile(resolved);
  if (!target) return { valid: false, reason: "missing output" };
  if (!containsFragment(target, resolved.hash)) return { valid: false, reason: "missing fragment" };

  return { valid: true };
}

function main() {
  if (!existsSync(distRoot)) {
    console.error("dist/ does not exist. Run the static build before checking links.");
    process.exitCode = 1;
    return;
  }

  const errors = [];
  for (const file of walk(distRoot)) {
    const html = readFileSync(file, "utf8");
    const references = [
      ...[...html.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)].map((match) => match[1]),
      ...[...html.matchAll(/\bsrcset=["']([^"']+)["']/gi)].flatMap((match) =>
        match[1]
          .split(",")
          .map((candidate) => candidate.trim().split(/\s+/, 1)[0])
          .filter(Boolean),
      ),
      ...[
        ...html.matchAll(
          /<meta\b[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/gi,
        ),
      ].map((match) => match[1]),
    ];
    for (const reference of references) {
      const result = validateReference(reference, file);
      if (result.valid) continue;
      errors.push(`${path.relative(projectRoot, file)} -> ${reference} (${result.reason})`);
    }
  }

  for (const file of walk(distRoot, new Set([".css"]))) {
    const css = readFileSync(file, "utf8");
    const references = [...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)].map(
      (match) => match[1],
    );
    for (const reference of references) {
      if (/^(?:#|%23)/i.test(reference)) continue;
      const result = validateReference(reference, file);
      if (result.valid) continue;
      errors.push(`${path.relative(projectRoot, file)} -> ${reference} (${result.reason})`);
    }
  }

  if (errors.length === 0) {
    console.log("Built-site internal links passed.");
    return;
  }

  console.error("Built-site links with an invalid or missing project base:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
}

main();
