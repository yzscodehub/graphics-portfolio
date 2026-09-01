import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ReviewedCourtyardCompileError,
  compileReviewedCourtyard,
  createReviewedCourtyardCommandPlan,
  sharpWebpHelperPath,
} from "../scripts/assets/compile-reviewed-courtyard.mjs";

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "reviewed-courtyard-compiler-"));
  const cacheRoot = path.join(root, "cache");
  const toolsRoot = path.join(root, "tools");
  const buildRoot = path.join(root, "build");
  mkdirSync(cacheRoot, { recursive: true });
  mkdirSync(toolsRoot, { recursive: true });
  mkdirSync(buildRoot, { recursive: true });
  const files = [
    ["courtyard.gltf", "mesh", "gltf"],
    ["albedo.jpg", "texture", "base-color"],
    ["normal.jpg", "texture", "normal"],
    ["courtyard.hdr", "hdri", "hdr"],
  ];
  const sourceFiles = files.map(([relative, kind, role]) => {
    const target = path.join(cacheRoot, kind, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    const bytes = Buffer.from("reviewed:" + relative);
    writeFileSync(target, bytes);
    return {
      kind,
      role,
      relativePath: relative,
      cachePath: `.cache/rendering-sources/${kind}/${relative}`,
      sha256: sha256(bytes),
      status: "reviewed",
    };
  });
  const sourceLock = {
    version: 2,
    policy: {
      downloaded: false,
      stage: "sources-reviewed",
      rawCache: ".cache/rendering-sources",
    },
    sources: [
      { id: "mesh", kind: "mesh", files: [sourceFiles[0]] },
      { id: "texture", kind: "texture", files: [sourceFiles[1], sourceFiles[2]] },
      { id: "hdri", kind: "hdri", files: [sourceFiles[3]] },
    ],
  };
  const tools: Record<
    string,
    { nodePath?: string; packageJsonPath?: string; path?: string; version: string }
  > = {};
  for (const [key, version] of Object.entries({
    gltfTransform: "4.4.2",
    gltfpack: "1.1",
    toktx: "4.4.2",
  })) {
    const executable = path.join(toolsRoot, key + ".tool");
    writeFileSync(executable, key);
    tools[key] = { path: executable, version };
  }
  const sharpPackageJson = path.join(toolsRoot, "sharp-package.json");
  writeFileSync(sharpPackageJson, JSON.stringify({ version: "0.35.4" }));
  tools.sharp = {
    nodePath: process.execPath,
    packageJsonPath: sharpPackageJson,
    version: "0.35.4",
  };
  return {
    root,
    cacheRoot,
    buildRoot,
    sourceLock,
    toolPaths: { tools },
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

function fixtureRunner({ output }: { output: string }) {
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, Buffer.from("artifact:" + path.basename(output)));
}

describe("courtyard candidate-foundation compiler transaction", () => {
  it("preflights, executes a deterministic plan, and commits only to caller output", () => {
    const state = fixture();
    try {
      const before = readFileSync(
        path.join(process.cwd(), "public/assets/rendering/packs/research-courtyard.pack.json"),
      );
      const result = compileReviewedCourtyard({
        sourceLock: state.sourceLock,
        cacheRoot: state.cacheRoot,
        toolPaths: state.toolPaths,
        buildRoot: state.buildRoot,
        outputDir: path.join(state.buildRoot, "first"),
        runCommand: fixtureRunner,
      });
      expect(result.status).toBe("candidate-committed");
      expect(result.manifest.status).toBe("candidate");
      expect(result.manifest.maturity).toBe("foundation");
      expect(result.manifest.publishable).toBe(false);
      expect(result.manifest.foundation.publicTarget).toBe("prohibited");
      expect(result.manifest.foundation.capabilities).toContain(
        "Processes one explicitly recorded reviewed glTF mesh input.",
      );
      expect(result.manifest.foundation.limitations).toContain(
        "Does not assemble the six-model Research Courtyard.",
      );
      expect(result.manifest.placeholder).toBe(false);
      expect(result.commands).toHaveLength(9);
      expect(readFileSync(path.join(result.outputDir, "transaction.json"), "utf8")).toContain(
        "candidate-committed",
      );
      expect(
        readFileSync(path.join(result.outputDir, "courtyard-candidate.manifest.json"), "utf8"),
      ).toContain('"status": "candidate"');
      expect(
        readFileSync(
          path.join(process.cwd(), "public/assets/rendering/packs/research-courtyard.pack.json"),
        ),
      ).toEqual(before);

      const second = compileReviewedCourtyard({
        sourceLock: state.sourceLock,
        cacheRoot: state.cacheRoot,
        toolPaths: state.toolPaths,
        buildRoot: state.buildRoot,
        outputDir: path.join(state.buildRoot, "second"),
        runCommand: fixtureRunner,
      });
      expect(second.manifest).toEqual(result.manifest);
    } finally {
      state.dispose();
    }
  });

  it("fails closed before output creation for missing or misbound reviewed inputs", () => {
    const state = fixture();
    try {
      const reviewedFile = state.sourceLock.sources[0].files[0];
      const originalSha = reviewedFile.sha256;
      reviewedFile.sha256 = "0".repeat(64);
      const output = path.join(state.buildRoot, "missing-input");
      expect(() =>
        compileReviewedCourtyard({
          sourceLock: state.sourceLock,
          cacheRoot: state.cacheRoot,
          toolPaths: state.toolPaths,
          buildRoot: state.buildRoot,
          outputDir: output,
          runCommand: fixtureRunner,
        }),
      ).toThrow(ReviewedCourtyardCompileError);
      expect(existsSync(output)).toBe(false);

      reviewedFile.sha256 = originalSha;
      reviewedFile.cachePath = ".cache/rendering-sources/mesh/other.gltf";
      const misbound = path.join(state.buildRoot, "misbound-input");
      expect(() =>
        compileReviewedCourtyard({
          sourceLock: state.sourceLock,
          cacheRoot: state.cacheRoot,
          toolPaths: state.toolPaths,
          buildRoot: state.buildRoot,
          outputDir: misbound,
          runCommand: fixtureRunner,
        }),
      ).toThrow(/exactly match/);
      expect(existsSync(misbound)).toBe(false);
    } finally {
      state.dispose();
    }
  });

  it("rolls back a staging transaction when a tool fails or output is missing", () => {
    const state = fixture();
    try {
      const failed = path.join(state.buildRoot, "failed");
      expect(() =>
        compileReviewedCourtyard({
          sourceLock: state.sourceLock,
          cacheRoot: state.cacheRoot,
          toolPaths: state.toolPaths,
          buildRoot: state.buildRoot,
          outputDir: failed,
          runCommand: () => {
            throw new Error("mock tool failure");
          },
        }),
      ).toThrow("mock tool failure");
      expect(existsSync(failed)).toBe(false);

      const missing = path.join(state.buildRoot, "missing");
      expect(() =>
        compileReviewedCourtyard({
          sourceLock: state.sourceLock,
          cacheRoot: state.cacheRoot,
          toolPaths: state.toolPaths,
          buildRoot: state.buildRoot,
          outputDir: missing,
          runCommand: () => undefined,
        }),
      ).toThrow("tool-output");
      expect(existsSync(missing)).toBe(false);
    } finally {
      state.dispose();
    }
  });

  it("uses the version-checked Node Sharp helper and rejects public output targets", () => {
    const state = fixture();
    try {
      const plan = createReviewedCourtyardCommandPlan({
        sourceLock: state.sourceLock,
        cacheRoot: state.cacheRoot,
        toolPaths: state.toolPaths,
        stagingRoot: path.join(state.buildRoot, "plan"),
      });
      expect(plan.commands.map((entry) => entry.args[0])).toEqual(
        expect.arrayContaining(["prune", "dedup", "-i", "--t2"]),
      );
      const webpCommands = plan.commands.filter((entry) => entry.executor === "node-sharp-helper");
      expect(webpCommands).toHaveLength(2);
      for (const command of webpCommands) {
        expect(command.tool).toBe(process.execPath);
        expect(command.args[0]).toBe(sharpWebpHelperPath);
        expect(command.args).toContain("--expected-sharp-version");
        expect(command.args).toContain("0.35.4");
      }
      expect(plan.foundation).toMatchObject({
        status: "candidate",
        maturity: "foundation",
        publicTarget: "prohibited",
        selectedInputs: {
          mesh: "mesh/courtyard.gltf",
          baseColor: "texture/albedo.jpg",
          normal: "texture/normal.jpg",
        },
      });
      const svg = path.join(state.root, "input.svg");
      const webp = path.join(state.root, "actual.webp");
      writeFileSync(
        svg,
        '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="#8dd3c7" /></svg>',
      );
      const conversion = spawnSync(
        process.execPath,
        [
          sharpWebpHelperPath,
          "--input",
          svg,
          "--output",
          webp,
          "--expected-sharp-version",
          "0.35.4",
        ],
        { encoding: "utf8" },
      );
      expect(conversion.status, conversion.stderr).toBe(0);
      expect(existsSync(webp)).toBe(true);
      expect(readFileSync(webp).subarray(0, 4).toString("ascii")).toBe("RIFF");
      expect(() =>
        compileReviewedCourtyard({
          sourceLock: state.sourceLock,
          cacheRoot: state.cacheRoot,
          toolPaths: state.toolPaths,
          buildRoot: process.cwd(),
          outputDir: path.join(process.cwd(), "public", "forbidden-reviewed-output"),
          runCommand: fixtureRunner,
        }),
      ).toThrow("must never target public assets");
    } finally {
      state.dispose();
    }
  });
});
