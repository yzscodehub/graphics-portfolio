import path from "node:path";
import { fileURLToPath } from "node:url";
import { findFetchBlockers } from "./fetch-sources.mjs";
import { loadRenderingSourceLock, projectRoot } from "./manifest.mjs";
import { verifyInstalledToolchain } from "./toolchain.mjs";

export const reviewedToolchain = [
  { command: "gltf-transform", version: "4.4.2" },
  { command: "gltfpack", version: "1.1" },
  { command: "toktx", version: "4.4.2" },
];

export function findReviewedRebuildBlockers(sourceLock, options = {}) {
  const blockers = [];
  const toolchainIssues =
    options.toolchainIssues ?? verifyInstalledToolchain(options.root ?? projectRoot);
  blockers.push(...toolchainIssues.map((issue) => "local rendering toolchain: " + issue));
  blockers.push(...findFetchBlockers(sourceLock));
  return blockers;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sourceLock = loadRenderingSourceLock(projectRoot);
  const blockers = findReviewedRebuildBlockers(sourceLock);
  if (blockers.length > 0) {
    console.error("Reviewed Research Courtyard preflight failed:");
    blockers.forEach((blocker) => console.error("- " + blocker));
    process.exitCode = 1;
  } else {
    console.log(
      "Reviewed source/tool preflight passed. The conversion compiler remains a separate explicit step.",
    );
  }
}
