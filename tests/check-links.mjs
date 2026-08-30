import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(projectRoot, "dist");
const projectBase = "/graphics-portfolio/";

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory()
      ? walk(fullPath)
      : path.extname(entry.name) === ".html"
        ? [fullPath]
        : [];
  });
}

function isExternal(reference) {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/|#|data:)/i.test(reference);
}

function stripQueryAndHash(reference) {
  return reference.split(/[?#]/, 1)[0];
}

function resolvesToOutput(reference, sourceFile) {
  const cleanReference = stripQueryAndHash(reference);
  if (!cleanReference) return true;

  let target;
  if (cleanReference.startsWith("/")) {
    if (!cleanReference.startsWith(projectBase)) return false;
    target = path.join(distRoot, cleanReference.slice(projectBase.length));
  } else {
    target = path.resolve(path.dirname(sourceFile), cleanReference);
  }

  if (existsSync(target) && statSync(target).isFile()) return true;
  return existsSync(path.join(target, "index.html"));
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
    const references = [...html.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)].map(
      (match) => match[1],
    );
    for (const reference of references) {
      if (isExternal(reference) || resolvesToOutput(reference, file)) continue;
      errors.push(`${path.relative(projectRoot, file)} -> ${reference}`);
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
