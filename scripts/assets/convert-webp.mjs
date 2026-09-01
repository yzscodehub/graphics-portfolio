import { existsSync, lstatSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

export const requiredSharpVersion = "0.35.4";

function fail(message) {
  throw new Error("convert-webp: " + message);
}

function sharpPackageVersion() {
  const require = createRequire(import.meta.url);
  const sharpEntry = require.resolve("sharp");
  const packageJsonPath = path.resolve(path.dirname(sharpEntry), "../package.json");
  return JSON.parse(readFileSync(packageJsonPath, "utf8")).version;
}

function requireOption(options, key) {
  const value = options.get(key);
  if (typeof value !== "string" || value.length === 0) fail("--" + key + " is required");
  return value;
}

export function parseConvertWebpArgs(argumentsList) {
  const options = new Map();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const key = argumentsList[index];
    const value = argumentsList[index + 1];
    if (
      !["--input", "--output", "--expected-sharp-version"].includes(key) ||
      typeof value !== "string" ||
      options.has(key.slice(2))
    ) {
      fail("expected unique --input, --output, and --expected-sharp-version options");
    }
    options.set(key.slice(2), value);
  }
  return {
    inputPath: requireOption(options, "input"),
    outputPath: requireOption(options, "output"),
    expectedSharpVersion: requireOption(options, "expected-sharp-version"),
  };
}

export async function convertWebp({ inputPath, outputPath, expectedSharpVersion }) {
  if (expectedSharpVersion !== requiredSharpVersion) {
    fail("expected version must be " + requiredSharpVersion);
  }
  const actualSharpVersion = sharpPackageVersion();
  if (actualSharpVersion !== expectedSharpVersion) {
    fail(
      "Sharp version mismatch: expected " +
        expectedSharpVersion +
        ", received " +
        actualSharpVersion,
    );
  }
  const input = path.resolve(inputPath);
  const output = path.resolve(outputPath);
  if (input === output || !existsSync(input) || !lstatSync(input).isFile()) {
    fail("input must be an existing file distinct from output");
  }
  if (path.extname(output).toLowerCase() !== ".webp") fail("output must use the .webp extension");
  if (existsSync(output)) fail("refusing to overwrite output");
  mkdirSync(path.dirname(output), { recursive: true });
  await sharp(input).webp({ quality: 90, effort: 4 }).toFile(output);
  if (!existsSync(output) || !lstatSync(output).isFile() || statSync(output).size < 1) {
    fail("Sharp did not produce a non-empty WebP output");
  }
  return { outputPath: output, bytes: statSync(output).size, sharpVersion: actualSharpVersion };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await convertWebp(parseConvertWebpArgs(process.argv.slice(2)));
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
