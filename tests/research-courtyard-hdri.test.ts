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

import { calculateSourceSetSha256 } from "../scripts/assets/manifest.mjs";
import {
  decodeRadianceRgbe,
  preprocessResearchCourtyardHdri,
  projectEquirectangularDiffuseSh9,
  ResearchCourtyardHdriError,
} from "../scripts/assets/research-courtyard-hdri.mjs";

const temporary: string[] = [];
const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const header = (imageWidth: number, imageHeight: number) =>
  Buffer.from(
    `#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${imageHeight} +X ${imageWidth}\n`,
    "ascii",
  );

function raw(imageWidth: number, imageHeight: number, samples: number[]) {
  return Buffer.concat([header(imageWidth, imageHeight), Buffer.from(samples)]);
}

function literals(values: number[]) {
  const output: number[] = [];
  for (let index = 0; index < values.length; index += 128)
    output.push(Math.min(128, values.length - index), ...values.slice(index, index + 128));
  return output;
}

function rle(imageWidth: number, imageHeight: number, sample: [number, number, number, number]) {
  const body: number[] = [];
  for (let row = 0; row < imageHeight; row += 1) {
    body.push(2, 2, imageWidth >> 8, imageWidth & 255);
    for (let channel = 0; channel < 4; channel += 1)
      body.push(...literals(Array.from({ length: imageWidth }, () => sample[channel])));
  }
  return Buffer.concat([header(imageWidth, imageHeight), Buffer.from(body)]);
}

function fixture() {
  const parent = mkdtempSync(path.join(os.tmpdir(), "courtyard-hdri-"));
  temporary.push(parent);
  const cacheRoot = path.join(parent, ".cache", "rendering-sources");
  const relative = "courtyard_1k.hdr";
  const file = path.join(cacheRoot, "courtyard-hdri-1k", relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, rle(1024, 512, [128, 128, 128, 129]));
  const sourceFile = {
    role: "hdr",
    relativePath: relative,
    directUrl: "https://example.invalid/courtyard_1k.hdr",
    bytes: statSync(file).size,
    md5: "0".repeat(32),
    sha256: hash(file),
    status: "reviewed",
    cachePath: ".cache/rendering-sources/courtyard-hdri-1k/courtyard_1k.hdr",
  };
  const sources = [
    {
      id: "courtyard-hdri-1k",
      kind: "hdri",
      page: "courtyard",
      sourceUrl: "https://example.invalid/courtyard",
      license: "CC0",
      authors: ["Test"],
      api: {
        infoUrl: "https://example.invalid/info",
        filesUrl: "https://example.invalid/files",
        filesHash: "1".repeat(40),
      },
      selection: { format: "hdr", resolution: "1k" },
      files: [sourceFile],
      usedBy: ["clustered-lighting"],
    },
  ];
  const sourceSetSha256 = calculateSourceSetSha256(sources);
  const sourceLock = {
    version: 3,
    policy: {
      stage: "sources-reviewed",
      license: "CC0",
      rawCache: ".cache/rendering-sources",
    },
    sourceSetSha256,
    sources,
    review: { reviewId: "fixture" },
  };
  const recipe = {
    environment: {
      sourceId: "courtyard-hdri-1k",
      path: sourceFile.cachePath,
      sha256: sourceFile.sha256,
      width: 1024,
      height: 512,
      colorSpace: "linear",
      diffuseShCoefficients: 9,
      publishEnvironmentResolution: 1024,
      specularIbl: false,
    },
  };
  const buildRoot = path.join(parent, "build");
  mkdirSync(buildRoot);
  return {
    cacheRoot,
    buildRoot,
    sourceLock,
    sourceLockSha256: "2".repeat(64),
    recipe,
    recipeSha256: "3".repeat(64),
  };
}

afterEach(() => {
  for (const directory of temporary.splice(0))
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 100,
    });
});

describe("Research Courtyard HDRI preprocessing", () => {
  it("decodes raw RGBE and scanline RLE into canonical linear RGB", () => {
    const decodedRaw = decodeRadianceRgbe(raw(2, 1, [128, 64, 32, 129, 64, 32, 16, 129]));
    expect(decodedRaw).toMatchObject({
      width: 2,
      height: 1,
      orientation: "-Y +X",
    });
    expect([...decodedRaw.linearRgb]).toEqual([1, 0.5, 0.25, 0.5, 0.25, 0.125]);
    const decodedRle = decodeRadianceRgbe(rle(8, 1, [128, 64, 32, 129]));
    expect([...decodedRle.linearRgb.slice(0, 3)]).toEqual([1, 0.5, 0.25]);
    expect(decodedRle.linearRgb[23]).toBe(0.25);
  });

  it("fails closed on truncated payloads, invalid RLE runs, and trailing bytes", () => {
    const valid = rle(8, 1, [128, 64, 32, 129]);
    expect(() => decodeRadianceRgbe(valid.subarray(0, -1))).toThrow(ResearchCourtyardHdriError);
    const bad = Buffer.concat([header(8, 1), Buffer.from([2, 2, 0, 8, 137, 4])]);
    expect(() => decodeRadianceRgbe(bad)).toThrow(/hdr-rle/);
    expect(() => decodeRadianceRgbe(Buffer.concat([valid, Buffer.from([0])]))).toThrow(
      /hdr-payload/,
    );
  });

  it("projects a constant environment to Lambertian diffuse SH9", () => {
    const linearRgb = new Float32Array(64 * 32 * 3).fill(1);
    const sh = projectEquirectangularDiffuseSh9({
      width: 64,
      height: 32,
      linearRgb,
    });
    const expectedL00 = 3.544907701811 * Math.PI;
    expect(sh.convolution).toBe("lambertian-cosine-v1");
    expect(sh.coefficients[0].rgb).toEqual([
      expect.closeTo(expectedL00, 9),
      expect.closeTo(expectedL00, 9),
      expect.closeTo(expectedL00, 9),
    ]);
    for (const coefficient of sh.coefficients.slice(1))
      for (const channel of coefficient.rgb) expect(Math.abs(channel)).toBeLessThan(1e-9);
  });

  it("writes deterministic, hash-bound candidates atomically", async () => {
    const input = fixture();
    const first = await preprocessResearchCourtyardHdri({
      ...input,
      outputDir: path.join(input.buildRoot, "candidate-a"),
    });
    const second = await preprocessResearchCourtyardHdri({
      ...input,
      outputDir: path.join(input.buildRoot, "candidate-b"),
    });
    expect(first.manifest).toEqual(second.manifest);
    expect(hash(first.manifestPath)).toBe(hash(second.manifestPath));
    expect(first.manifest).toMatchObject({
      status: "candidate",
      publishable: false,
      sourceLockSha256: "2".repeat(64),
      recipeSha256: "3".repeat(64),
      specularIbl: false,
      runtimeHdr: false,
    });
    expect(first.manifest.preview).toMatchObject({
      purpose: "tonemapped-review-preview-only",
      hdrRuntime: false,
      width: 1024,
      height: 512,
    });
    const preview = first.manifest.preview;
    if (!preview) throw new Error("Expected the HDRI review preview.");
    expect(existsSync(path.join(first.outputDir, preview.path))).toBe(true);
    await expect(
      preprocessResearchCourtyardHdri({
        ...input,
        outputDir: first.outputDir,
      }),
    ).rejects.toMatchObject({ code: "output-path" });
  });

  it("optionally smoke-decodes the locally reviewed HDRI", () => {
    const local = path.resolve(".cache/rendering-sources/courtyard-hdri-1k/courtyard_1k.hdr");
    if (!existsSync(local)) return;
    expect(decodeRadianceRgbe(readFileSync(local))).toMatchObject({
      width: 1024,
      height: 512,
    });
  });
});
