import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { overlayCandidateForReview } from "../scripts/build-courtyard-review.mjs";

const temporary: string[] = [];
const digest = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("local Courtyard review build", () => {
  it("copies only receipt-bound candidate files into an existing gated build", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "courtyard-review-"));
    temporary.push(root);
    const candidate = path.join(root, "candidate");
    const dist = path.join(root, "dist");
    const artifact = path.join(candidate, "runtime.manifest.json");
    mkdirSync(candidate, { recursive: true });
    mkdirSync(path.join(dist, "review/research-courtyard"), {
      recursive: true,
    });
    writeFileSync(path.join(dist, "review/research-courtyard/index.html"), "review");
    writeFileSync(artifact, "runtime");
    const manifest = {
      status: "candidate",
      publishable: false,
      candidateArtifactsSha256: "a".repeat(64),
      runtimeManifest: {
        uri: "runtime.manifest.json",
        bytes: statSync(artifact).size,
        sha256: digest(artifact),
      },
      files: [
        {
          uri: "runtime.manifest.json",
          bytes: statSync(artifact).size,
          sha256: digest(artifact),
        },
      ],
    };
    const manifestPath = path.join(candidate, "candidate.manifest.json");
    writeFileSync(manifestPath, JSON.stringify(manifest));
    overlayCandidateForReview({ directory: candidate, manifestPath, manifest }, dist);
    expect(
      existsSync(path.join(dist, "assets/rendering/research-courtyard/runtime.manifest.json")),
    ).toBe(true);
    expect(existsSync(path.join(dist, "courtyard-review-build.json"))).toBe(true);
    expect(() =>
      overlayCandidateForReview({ directory: candidate, manifestPath, manifest }, dist),
    ).toThrow(/already exists/);
  });
});
