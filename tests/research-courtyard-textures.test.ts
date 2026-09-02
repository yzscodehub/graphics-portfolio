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
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { calculateSourceSetSha256 } from "../scripts/assets/manifest.mjs";
import {
  ResearchCourtyardTextureError,
  parseResearchCourtyardTextureArgs,
  preprocessResearchCourtyardTextures,
  texturePreprocessContract,
} from "../scripts/assets/research-courtyard-textures.mjs";

const temporaryRoots: string[] = [];

function sha256(file: string) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function createRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), "courtyard-textures-"));
  temporaryRoots.push(root);
  return root;
}

async function writeRgb(file: string, sample: Uint8Array, alternate?: Uint8Array) {
  mkdirSync(path.dirname(file), { recursive: true });
  const data = Buffer.alloc(1024 * 1024 * 3);
  for (let index = 0; index < data.length; index += 3) {
    const pixel = index / 3;
    data.set(alternate && pixel % 2 === 1 ? alternate : sample, index);
  }
  await sharp(data, {
    raw: { width: 1024, height: 1024, channels: 3 },
  })
    .png()
    .toFile(file);
}

function descriptor(root: string, sourceId: string, relativePath: string, role: string) {
  const file = path.join(root, ".cache", "rendering-sources", sourceId, ...relativePath.split("/"));
  return {
    role,
    relativePath,
    directUrl: "https://dl.polyhaven.org/file/test/" + relativePath,
    bytes: statSync(file).size,
    md5: "0".repeat(32),
    sha256: sha256(file),
    status: "reviewed",
    cachePath: `.cache/rendering-sources/${sourceId}/${relativePath}`,
  };
}

async function fixture() {
  const root = createRoot();
  const cacheRoot = path.join(root, ".cache", "rendering-sources");
  const materialId = "test-material";
  await writeRgb(path.join(cacheRoot, materialId, "base.png"), new Uint8Array([12, 24, 48]));
  await writeRgb(path.join(cacheRoot, materialId, "normal.png"), new Uint8Array([128, 128, 255]));
  await writeRgb(path.join(cacheRoot, materialId, "roughness.png"), new Uint8Array([64, 64, 64]));
  await writeRgb(
    path.join(
      cacheRoot,
      "modular-chainlink-fence",
      "textures",
      "modular_chainlink_fence_wire_diff_1k.jpg",
    ),
    new Uint8Array([128, 0, 0]),
    new Uint8Array([0, 0, 0]),
  );
  const sourceFiles = [
    descriptor(root, materialId, "base.png", "base-color"),
    descriptor(root, materialId, "normal.png", "normal"),
    descriptor(root, materialId, "roughness.png", "roughness"),
  ];
  const wireFile = descriptor(
    root,
    "modular-chainlink-fence",
    "textures/modular_chainlink_fence_wire_diff_1k.jpg",
    "gltf-include",
  );
  const sources = [
    {
      id: materialId,
      kind: "texture",
      page: "test_material",
      sourceUrl: "https://polyhaven.com/a/test_material",
      license: "CC0",
      authors: ["Test author"],
      api: {
        infoUrl: "https://api.polyhaven.com/info/test_material",
        filesUrl: "https://api.polyhaven.com/files/test_material",
        filesHash: "1".repeat(40),
      },
      selection: { format: "jpg", resolution: "1k" },
      files: sourceFiles,
      usedBy: ["clustered-lighting"],
    },
    {
      id: "modular-chainlink-fence",
      kind: "mesh",
      page: "modular_chainlink_fence",
      sourceUrl: "https://polyhaven.com/a/modular_chainlink_fence",
      license: "CC0",
      authors: ["Test author"],
      api: {
        infoUrl: "https://api.polyhaven.com/info/modular_chainlink_fence",
        filesUrl: "https://api.polyhaven.com/files/modular_chainlink_fence",
        filesHash: "2".repeat(40),
      },
      selection: { format: "gltf", resolution: "1k", include: true },
      files: [wireFile],
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
    review: { reviewId: "test-review" },
  };
  const recipe = {
    sourceSetSha256,
    materialSources: [
      {
        materialId,
        sourceId: materialId,
        metallicFactor: 0.5,
        maps: {
          baseColor: {
            path: sourceFiles[0].cachePath,
            sha256: sourceFiles[0].sha256,
            colorSpace: "srgb",
            encoding: "etc1s",
          },
          normal: {
            path: sourceFiles[1].cachePath,
            sha256: sourceFiles[1].sha256,
            colorSpace: "linear",
            encoding: "uastc",
            normalConvention: "opengl-positive-y",
          },
          roughness: {
            path: sourceFiles[2].cachePath,
            sha256: sourceFiles[2].sha256,
            colorSpace: "linear",
            encoding: "etc1s",
          },
        },
        orm: {
          occlusionConstant: 1,
          roughnessSource: "roughness",
          metallicSource: "metallicFactor",
        },
      },
    ],
    meshSources: [
      {
        sourceId: "modular-chainlink-fence",
        materialOverrides: [
          {
            materialName: "modular_chainlink_fence_wire",
            alphaMode: "MASK",
            alphaCutoff: 0.5,
            doubleSided: true,
            renderPass: "alpha-mask-forward",
            alphaSource: {
              kind: "max-rgb",
              threshold: 0.5,
              sourceRole: "base-color",
            },
          },
        ],
      },
    ],
  };
  const buildRoot = path.join(root, "build");
  mkdirSync(buildRoot);
  return { root, cacheRoot, buildRoot, sourceLock, recipe };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0))
    rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 100,
    });
});

describe("Research Courtyard deterministic texture preprocessing", () => {
  it("creates fixed PNG/WebP candidates, ORM channels, fence alpha, and KTX2 descriptors", async () => {
    const input = await fixture();
    const result = await preprocessResearchCourtyardTextures({
      ...input,
      outputDir: path.join(input.buildRoot, "candidate"),
    });
    expect(result.manifest.status).toBe("candidate");
    expect(result.manifest.publishable).toBe(false);
    expect(result.manifest.materials).toHaveLength(1);
    expect(result.manifest.contract.webp).toEqual(texturePreprocessContract.webp);
    expect(result.manifest.materials[0].maps[0].transcode.encoding).toBe("etc1s");
    expect(result.manifest.materials[0].maps[1].transcode.args).toContain("--normal_mode");
    expect(result.manifest.materials[0].maps[1].transcode.args).toContain("--assign_oetf");
    expect(result.manifest.materials[0].maps[2].metallicByte).toBe(128);
    expect(result.manifest.fence.transcode.execution).toBe("not-executed");
    expect(result.manifest.fence.transcode.encoding).toBe("uastc");
    expect(existsSync(path.join(result.outputDir, "ktx2"))).toBe(false);
    const orm = await sharp(path.join(result.outputDir, "intermediate", "test-material-orm.png"))
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(orm.info).toMatchObject({
      width: 1024,
      height: 1024,
      channels: 4,
    });
    expect([...orm.data.subarray(0, 4)]).toEqual([255, 64, 128, 255]);
    const fence = await sharp(
      path.join(result.outputDir, "intermediate", "fence-wire-basecolor-alpha.png"),
    )
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(fence.info).toMatchObject({
      width: 1024,
      height: 1024,
      channels: 4,
    });
    expect([...fence.data.subarray(0, 4)]).toEqual([128, 0, 0, 255]);
    expect([...fence.data.subarray(4, 8)]).toEqual([0, 0, 0, 0]);
    expect(JSON.parse(readFileSync(result.manifestPath, "utf8"))).toEqual(result.manifest);
  });

  it("is deterministic and refuses overwrites", async () => {
    const input = await fixture();
    const first = await preprocessResearchCourtyardTextures({
      ...input,
      outputDir: path.join(input.buildRoot, "candidate-a"),
    });
    const second = await preprocessResearchCourtyardTextures({
      ...input,
      outputDir: path.join(input.buildRoot, "candidate-b"),
    });
    expect(first.manifest).toEqual(second.manifest);
    expect(sha256(first.manifestPath)).toBe(sha256(second.manifestPath));
    await expect(
      preprocessResearchCourtyardTextures({
        ...input,
        outputDir: first.outputDir,
      }),
    ).rejects.toMatchObject({ code: "output-exists" });
  });

  it("fails closed on input drift, output escape, and malformed CLI arguments", async () => {
    const changed = await fixture();
    writeFileSync(path.join(changed.cacheRoot, "test-material", "base.png"), "tampered");
    await expect(
      preprocessResearchCourtyardTextures({
        ...changed,
        outputDir: path.join(changed.buildRoot, "tampered"),
      }),
    ).rejects.toMatchObject({ code: "source-bytes" });
    const escaped = await fixture();
    await expect(
      preprocessResearchCourtyardTextures({
        ...escaped,
        outputDir: path.resolve(escaped.buildRoot, "..", "escaped"),
      }),
    ).rejects.toMatchObject({ code: "output-path" });
    expect(() => parseResearchCourtyardTextureArgs(["--recipe", "recipe.json"])).toThrow(
      ResearchCourtyardTextureError,
    );
  });
});
