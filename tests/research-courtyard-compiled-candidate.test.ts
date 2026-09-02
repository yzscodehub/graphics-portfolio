import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parsePackedSceneV2 } from "../src/demos/research-courtyard/packed-scene-v2";
import {
  assertRuntimeManifestV2MatchesPack,
  parseResearchCourtyardRuntimeManifestV2,
} from "../src/demos/research-courtyard/runtime-manifest-v2";

const digest = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

describe("locally compiled Research Courtyard candidate", () => {
  it("optionally validates every receipt and the Pack/Runtime v2 bridge", () => {
    const firstRoot = path.resolve(".cache/rendering-builds/research-courtyard-v2/complete-v3");
    if (!existsSync(firstRoot)) return;
    const manifestPath = path.join(firstRoot, "candidate.manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest).toMatchObject({
      status: "candidate",
      publishable: false,
      counts: {
        meshes: 27,
        materials: 13,
        instances: 34,
        animatedInstances: 1,
      },
    });
    expect(manifest.budgets.courtyardGeometryBytes).toBeLessThanOrEqual(3.5 * 1024 * 1024);
    expect(manifest.budgets.ktx2Bytes).toBeLessThanOrEqual(5 * 1024 * 1024);
    expect(manifest.budgets.webpFallbackBytes).toBeLessThanOrEqual(3 * 1024 * 1024);
    expect(manifest.budgets.publicRenderingBytes).toBeLessThanOrEqual(20 * 1024 * 1024);
    for (const receipt of manifest.files) {
      const file = path.join(firstRoot, ...receipt.uri.split("/"));
      expect(statSync(file).size).toBe(receipt.bytes);
      expect(digest(file)).toBe(receipt.sha256);
    }
    const pack = parsePackedSceneV2(
      JSON.parse(
        readFileSync(path.join(firstRoot, "courtyard/research-courtyard.pack.json"), "utf8"),
      ),
    );
    const runtime = parseResearchCourtyardRuntimeManifestV2(
      JSON.parse(readFileSync(path.join(firstRoot, "runtime.manifest.json"), "utf8")),
    );
    expect(() => assertRuntimeManifestV2MatchesPack(runtime, pack)).not.toThrow();
    expect(runtime.environment).toMatchObject({
      specularIbl: false,
      runtimeHdr: false,
    });

    const secondManifest = path.resolve(
      ".cache/rendering-builds/research-courtyard-v2/complete-v4/candidate.manifest.json",
    );
    if (existsSync(secondManifest))
      expect(readFileSync(manifestPath)).toEqual(readFileSync(secondManifest));
  });
});
