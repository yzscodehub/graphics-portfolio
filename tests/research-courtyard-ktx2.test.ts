import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildToktxInvocation,
  loadResearchCourtyardTextureCandidate,
  loadResearchCourtyardRuntimeTextures,
  transcodeResearchCourtyardKtx2,
} from "../scripts/assets/research-courtyard-ktx2.mjs";

const temporary: string[] = [];
const ktx2Magic = Buffer.from([
  0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const digest = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");

function receipt(file: string, root: string, colorSpace: string) {
  return {
    path: path.relative(root, file).replaceAll("\\", "/"),
    bytes: statSync(file).size,
    sha256: digest(readFileSync(file)),
    colorSpace,
    width: 512,
    height: 512,
    channels: 3,
  };
}

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "courtyard-ktx2-"));
  temporary.push(root);
  const candidate = path.join(root, ".cache", "texture-input");
  const intermediate = path.join(candidate, "intermediate", "stone-basecolor.png");
  const fallback = path.join(candidate, "fallback", "stone-basecolor.webp");
  mkdirSync(path.dirname(intermediate), { recursive: true });
  mkdirSync(path.dirname(fallback), { recursive: true });
  writeFileSync(intermediate, "png");
  writeFileSync(fallback, "webp");
  const map = {
    id: "basecolor",
    intermediate: receipt(intermediate, candidate, "srgb"),
    fallback: receipt(fallback, candidate, "srgb"),
    transcode: {
      tool: "toktx",
      version: "4.4.2",
      execution: "not-executed",
      id: "stone-basecolor",
      encoding: "etc1s",
      colorSpace: "srgb",
      inputPath: "intermediate/stone-basecolor.png",
      outputPath: "ktx2/stone-basecolor.ktx2",
      args: [
        "--t2",
        "--encode",
        "etc1s",
        "--assign_oetf",
        "srgb",
        "--genmipmap",
        "--threads",
        "1",
        "ktx2/stone-basecolor.ktx2",
        "intermediate/stone-basecolor.png",
      ],
    },
  };
  const linearMap = (id: string) => ({
    ...map,
    id,
    intermediate: {
      ...map.intermediate,
      path: `intermediate/stone-${id}.png`,
      colorSpace: "linear",
    },
    fallback: { ...map.fallback, path: `fallback/stone-${id}.webp`, colorSpace: "linear" },
    transcode: {
      ...map.transcode,
      id: `stone-${id}`,
      colorSpace: "linear",
      inputPath: `intermediate/stone-${id}.png`,
      outputPath: `ktx2/stone-${id}.ktx2`,
      args: [
        "--t2",
        "--encode",
        "etc1s",
        "--assign_oetf",
        "linear",
        "--genmipmap",
        "--threads",
        "1",
        `ktx2/stone-${id}.ktx2`,
        `intermediate/stone-${id}.png`,
      ],
    },
  });
  const normal = linearMap("normal");
  const orm = linearMap("orm");
  for (const item of [normal, orm]) {
    const image = path.join(candidate, ...item.intermediate.path.split("/"));
    const webp = path.join(candidate, ...item.fallback.path.split("/"));
    mkdirSync(path.dirname(image), { recursive: true });
    mkdirSync(path.dirname(webp), { recursive: true });
    writeFileSync(image, item.id);
    writeFileSync(webp, item.id);
    item.intermediate = receipt(image, candidate, "linear");
    item.fallback = receipt(webp, candidate, "linear");
  }
  const manifest = {
    format: "graphics-portfolio-research-courtyard-textures",
    version: 1,
    status: "candidate",
    publishable: false,
    sourceSetSha256: "a".repeat(64),
    sourceLockSha256: "b".repeat(64),
    recipeSha256: "c".repeat(64),
    materials: [{ id: "stone", maps: [map, normal, orm] }],
    modelMaterials: [],
  };
  writeFileSync(
    path.join(candidate, "texture-candidate.manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  const toolchain = {
    lockSha256: "d".repeat(64),
    commands: {
      "ktx-software-toktx": {
        id: "ktx-software-toktx",
        version: "4.4.2",
        commandPath: "toktx.exe",
        commandArgs: [],
        executableSha256: "e".repeat(64),
      },
    },
  };
  return {
    root,
    candidate,
    outputRoot: path.join(root, ".cache", "runtime-textures"),
    toolchain,
  };
}

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Research Courtyard KTX2 transcoding", () => {
  it("loads only hash-bound texture candidates and replaces locked path arguments", () => {
    const input = fixture();
    const loaded = loadResearchCourtyardTextureCandidate(input.candidate);
    const invocation = buildToktxInvocation(
      input.toolchain.commands["ktx-software-toktx"],
      loaded.records[0],
      "absolute-input.png",
      "absolute-output.ktx2",
    );
    expect(invocation.arguments.slice(-2)).toEqual(["absolute-output.ktx2", "absolute-input.png"]);
  });

  it("creates deterministic paired KTX2/WebP candidates inside both budgets", async () => {
    const input = fixture();
    const run = async (
      _command: string,
      argumentsList: string[],
      _cwd: string,
      metadata: { output: string },
    ) => {
      expect(argumentsList).toContain("--threads");
      writeFileSync(metadata.output, Buffer.concat([ktx2Magic, Buffer.from("fixture")]));
    };
    const first = await transcodeResearchCourtyardKtx2({
      ...input,
      textureCandidateDir: input.candidate,
      candidateId: "candidate-a",
      run,
    });
    const second = await transcodeResearchCourtyardKtx2({
      ...input,
      textureCandidateDir: input.candidate,
      candidateId: "candidate-b",
      run,
    });
    expect(first.manifest).toEqual(second.manifest);
    expect(digest(readFileSync(first.manifestPath))).toBe(
      digest(readFileSync(second.manifestPath)),
    );
    expect(first.manifest.totals).toMatchObject({
      textureCount: 3,
      ktx2Bytes: 57,
      webpBytes: 13,
    });
    expect(first.manifest.materials).toEqual({
      "architecture:stone": {
        baseColor: "stone-basecolor",
        normal: "stone-normal",
        orm: "stone-orm",
      },
    });
    expect(existsSync(path.join(first.outputDir, "textures/stone-basecolor.webp"))).toBe(true);
    const loaded = loadResearchCourtyardRuntimeTextures(first.outputDir);
    expect(loaded.catalog.textures).toHaveLength(3);
    writeFileSync(path.join(first.outputDir, "textures/stone-basecolor.webp"), "tampered");
    expect(() => loadResearchCourtyardRuntimeTextures(first.outputDir)).toThrow(
      /candidate receipt/,
    );
  });

  it("rolls staging back after an encoder failure", async () => {
    const input = fixture();
    await expect(
      transcodeResearchCourtyardKtx2({
        ...input,
        textureCandidateDir: input.candidate,
        candidateId: "failed",
        run: async () => {
          throw new Error("injected toktx failure");
        },
      }),
    ).rejects.toThrow(/injected toktx failure/);
    expect(existsSync(path.join(input.outputRoot, "failed"))).toBe(false);
    expect(
      existsSync(input.outputRoot)
        ? readdirSync(input.outputRoot).filter((entry) => entry.startsWith(".staging"))
        : [],
    ).toEqual([]);
  });
});
