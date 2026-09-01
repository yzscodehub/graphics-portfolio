import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRenderingSourceLock, projectRoot } from "./manifest.mjs";

const cacheRoot = path.join(projectRoot, ".cache", "rendering-sources");

export function findFetchBlockers(sourceLock) {
  return sourceLock.sources.flatMap((source) => {
    const sourceHash = source.sourceSha256 ?? sourceLock.defaults.sourceSha256;
    if (!/^[a-f0-9]{64}$/.test(sourceHash ?? "")) return [`${source.id}: reviewed SHA-256`];
    if (!/^https:\/\//.test(source.downloadUrl ?? ""))
      return [`${source.id}: direct HTTPS download URL`];
    return [];
  });
}

export async function fetchReviewedSources(sourceLock, destination = cacheRoot) {
  const blockers = findFetchBlockers(sourceLock);
  if (blockers.length > 0) throw new Error(`Missing ${blockers.join(", ")}.`);

  mkdirSync(destination, { recursive: true });
  for (const source of sourceLock.sources) {
    const response = await globalThis.fetch(source.downloadUrl, { redirect: "error" });
    if (!response.ok) throw new Error(`${source.id}: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const actualHash = createHash("sha256").update(bytes).digest("hex");
    const expectedHash = source.sourceSha256 ?? sourceLock.defaults.sourceSha256;
    if (actualHash !== expectedHash) throw new Error(`${source.id}: SHA-256 mismatch`);
    writeFileSync(path.join(destination, `${source.id}.source`), bytes);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sourceLock = loadRenderingSourceLock(projectRoot);
  const blockers = findFetchBlockers(sourceLock);
  if (blockers.length > 0) {
    console.error("Refusing external asset fetch until every source has reviewed provenance:");
    blockers.forEach((blocker) => console.error(`- ${blocker}`));
    process.exitCode = 1;
  } else {
    await fetchReviewedSources(sourceLock);
    console.log(`Fetched reviewed sources into ${path.relative(projectRoot, cacheRoot)}.`);
  }
}
