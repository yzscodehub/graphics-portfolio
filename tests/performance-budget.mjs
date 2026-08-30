import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function validatePerformanceBudgets(projectRoot = root) {
  const output = path.join(projectRoot, "dist");
  const violations = [];
  if (!existsSync(output)) return [{ code: "missing-dist", file: "dist", bytes: 0, limit: 0 }];

  const pages = ["index.html", "work/index.html", "writing/index.html", "about/index.html"];
  for (const relative of pages) {
    const file = path.join(output, relative);
    if (!existsSync(file)) continue;
    const html = readFileSync(file, "utf8");
    const scriptPaths = [...html.matchAll(/<script[^>]+src=["']([^"']+\.js)["']/g)].map(
      (match) => match[1],
    );
    const scriptBytes = scriptPaths.reduce((total, url) => {
      const asset = resolveBuiltUrl(output, url);
      return total + (existsSync(asset) ? gzipSync(readFileSync(asset), { level: 9 }).length : 0);
    }, 0);
    const inlineBytes = [
      ...html.matchAll(/<script(?![^>]+src=)[^>]*>([\s\S]*?)<\/script>/g),
    ].reduce((total, match) => total + gzipSync(Buffer.from(match[1]), { level: 9 }).length, 0);
    const limit = relative === "index.html" ? 120 * 1024 : 80 * 1024;
    if (scriptBytes + inlineBytes > limit)
      violations.push({
        code: "initial-js",
        file: `dist/${relative}`,
        bytes: scriptBytes + inlineBytes,
        limit,
      });
  }

  const astroAssets = path.join(output, "_astro");
  if (existsSync(astroAssets)) {
    let threeRuntimeBytes = 0;
    for (const name of readdirSync(astroAssets)) {
      const file = path.join(astroAssets, name);
      if (!statSync(file).isFile()) continue;
      const gzipBytes = gzipSync(readFileSync(file), { level: 9 }).length;
      if (/^three\.(?:core|tsl|webgpu)\..+\.js$/.test(name)) threeRuntimeBytes += gzipBytes;
      if (name.startsWith("three.webgpu") && gzipBytes > 220 * 1024)
        violations.push({
          code: "hero-runtime",
          file: `dist/_astro/${name}`,
          bytes: gzipBytes,
          limit: 220 * 1024,
        });
      if (name.endsWith(".wasm") && gzipBytes > 7 * 1024 * 1024)
        violations.push({
          code: "wasm-transfer",
          file: `dist/_astro/${name}`,
          bytes: gzipBytes,
          limit: 7 * 1024 * 1024,
        });
    }
    if (threeRuntimeBytes > 320 * 1024)
      violations.push({
        code: "three-runtime-total",
        file: "dist/_astro/three.*.js",
        bytes: threeRuntimeBytes,
        limit: 320 * 1024,
      });
  }

  for (const file of walk(output)) {
    const bytes = statSync(file).size;
    const extension = path.extname(file).toLowerCase();
    const relative = path.relative(projectRoot, file).replaceAll(path.sep, "/");
    if (/poster\.(?:png|webp|avif|svg)$/i.test(file) && bytes > 350 * 1024)
      violations.push({ code: "poster-size", file: relative, bytes, limit: 350 * 1024 });
    if (extension === ".webm" && bytes > 8 * 1024 * 1024)
      violations.push({ code: "video-size", file: relative, bytes, limit: 8 * 1024 * 1024 });
    if (extension === ".onnx" && bytes > 5 * 1024 * 1024)
      violations.push({ code: "model-size", file: relative, bytes, limit: 5 * 1024 * 1024 });
  }
  return violations;
}

function resolveBuiltUrl(output, url) {
  const pathname = new URL(url, "https://example.invalid").pathname;
  const base = "/graphics-portfolio/";
  return path.join(
    output,
    pathname.startsWith(base) ? pathname.slice(base.length) : pathname.slice(1),
  );
}

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const violations = validatePerformanceBudgets();
if (violations.length) {
  console.error("Performance budget violations:");
  violations.forEach((violation) =>
    console.error(
      `- [${violation.code}] ${violation.file}: ${violation.bytes} > ${violation.limit}`,
    ),
  );
  process.exitCode = 1;
} else {
  console.log("Performance budgets passed.");
}
