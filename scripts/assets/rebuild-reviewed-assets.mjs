import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findFetchBlockers } from "./fetch-sources.mjs";
import { loadRenderingSourceLock, projectRoot } from "./manifest.mjs";

export const reviewedToolchain = [
  { command: "gltf-transform", version: "4.4.2" },
  { command: "gltfpack", version: "1.1" },
  { command: "toktx", version: "4.4.2" },
];

function toolVersion(command) {
  const locator = spawnSync(process.platform === "win32" ? "where.exe" : "which", [command], {
    encoding: "utf8",
    shell: false,
  });
  const executable = String(locator.stdout || "")
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find(Boolean);
  if (locator.error || locator.status !== 0 || !executable) return "";
  const windowsScript =
    process.platform === "win32" &&
    [".cmd", ".bat"].includes(path.extname(executable).toLowerCase());
  const result = windowsScript
    ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${executable}" --version`], {
        encoding: "utf8",
        shell: false,
      })
    : spawnSync(executable, ["--version"], { encoding: "utf8", shell: false });
  if (result.error || result.status !== 0) return "";
  return String(result.stdout || result.stderr || "").trim();
}

export function findReviewedRebuildBlockers(sourceLock, versionLookup = toolVersion) {
  const blockers = [];
  for (const tool of reviewedToolchain) {
    const actual = versionLookup(tool.command);
    if (!actual.includes(tool.version))
      blockers.push(
        "tool " + tool.command + "@" + tool.version + " (found: " + (actual || "missing") + ")",
      );
  }
  blockers.push(...findFetchBlockers(sourceLock));
  if (!sourceLock.policy || sourceLock.policy.downloaded !== true)
    blockers.push(
      "source lock is metadata-locked; reviewed raw-source SHA-256 values are required before conversion",
    );
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
