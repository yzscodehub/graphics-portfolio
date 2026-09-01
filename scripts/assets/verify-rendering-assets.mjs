import { projectRoot, validateRenderingAssets } from "./manifest.mjs";

const violations = validateRenderingAssets(projectRoot);
if (violations.length > 0) {
  console.error("Rendering asset validation failed:");
  for (const violation of violations)
    console.error(`- [${violation.code}] ${violation.file} (${violation.value})`);
  process.exitCode = 1;
} else {
  console.log("Rendering asset manifest, hashes, budgets, and source lock passed.");
}
