import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  generateSourceReviewPacket,
  parseSourceReviewPacketArguments,
} from "../scripts/assets/source-review-packet.mjs";
import { calculateSourceSetSha256 } from "../scripts/assets/manifest.mjs";

type FixtureFile = {
  role: string;
  relativePath: string;
  directUrl: string;
  bytes: number;
  md5: string;
  sha256: null;
  status: "metadata-locked";
  cachePath: string;
};
type FixtureSource = {
  id: string;
  kind: "mesh" | "texture" | "hdri";
  page: string;
  sourceUrl: string;
  license: "CC0";
  authors: string[];
  files: FixtureFile[];
};
type RenderVisualInput = { stage: string; models: Array<{ sourceId: string }> };

const hash = (bytes: Uint8Array, algorithm: "md5" | "sha256") =>
  createHash(algorithm).update(bytes).digest("hex");

async function fixture(badUri?: string) {
  const root = mkdtempSync(path.join(os.tmpdir(), "review-packet-"));
  const reviewId = "packet-001";
  const quarantine = path.join(root, ".cache", "rendering-quarantine", reviewId);
  const jpeg = await sharp({
    create: { width: 2, height: 2, channels: 3, background: { r: 16, g: 32, b: 64 } },
  })
    .jpeg()
    .toBuffer();
  const hdr = Buffer.concat([
    Buffer.from("#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 1\n", "ascii"),
    Buffer.from([1, 1, 1, 128]),
  ]);
  const triangle = Buffer.from(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]).buffer);
  const sources: FixtureSource[] = [];
  const sourceFiles: Array<{ source: FixtureSource; file: FixtureFile; bytes: Buffer }> = [];
  const add = (source: FixtureSource, role: string, relativePath: string, bytes: Buffer) => {
    const file: FixtureFile = {
      role,
      relativePath,
      directUrl: "https://dl.polyhaven.org/file/fixture/" + source.id + "/" + relativePath,
      bytes: bytes.length,
      md5: hash(bytes, "md5"),
      sha256: null,
      status: "metadata-locked",
      cachePath: ".cache/rendering-sources/" + source.id + "/" + relativePath,
    };
    source.files.push(file);
    sourceFiles.push({ source, file, bytes });
  };
  for (const [index, count] of [5, 8, 5, 5, 8, 5].entries()) {
    const source: FixtureSource = {
      id: "mesh-" + index,
      kind: "mesh",
      page: "mesh_" + index,
      sourceUrl: "https://polyhaven.com/a/mesh_" + index,
      license: "CC0",
      authors: ["Fixture author"],
      files: [],
    };
    const gltf = Buffer.from(
      JSON.stringify({
        asset: { version: "2.0" },
        buffers: [
          { uri: badUri && index === 0 ? badUri : "mesh.bin", byteLength: triangle.length },
        ],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: triangle.length }],
        accessors: [
          {
            bufferView: 0,
            componentType: 5126,
            count: 3,
            type: "VEC3",
            min: [-0.5, -0.5, 0],
            max: [0.5, 0.5, 0],
          },
        ],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
        nodes: [{ mesh: 0 }],
        materials: [],
        scenes: [{ nodes: [0] }],
        scene: 0,
      }),
    );
    add(source, "gltf", "model.gltf", gltf);
    add(source, "gltf-include", "mesh.bin", triangle);
    for (let extra = 0; extra < count - 2; extra += 1)
      add(source, "gltf-include", "textures/texture-" + extra + ".jpg", jpeg);
    sources.push(source);
  }
  for (let index = 0; index < 4; index += 1) {
    const source: FixtureSource = {
      id: "texture-" + index,
      kind: "texture",
      page: "texture_" + index,
      sourceUrl: "https://polyhaven.com/a/texture_" + index,
      license: "CC0",
      authors: ["Fixture author"],
      files: [],
    };
    add(source, "base-color", "base.jpg", jpeg);
    add(source, "normal", "normal.jpg", jpeg);
    add(source, "roughness", "rough.jpg", jpeg);
    sources.push(source);
  }
  const environment: FixtureSource = {
    id: "environment-0",
    kind: "hdri",
    page: "environment_0",
    sourceUrl: "https://polyhaven.com/a/environment_0",
    license: "CC0",
    authors: ["Fixture author"],
    files: [],
  };
  add(environment, "hdr", "environment.hdr", hdr);
  sources.push(environment);
  const sourceLock = {
    version: 3,
    policy: {
      stage: "metadata-locked",
      license: "CC0",
      rawCache: ".cache/rendering-sources",
    },
    sourceSetSha256: calculateSourceSetSha256(sources),
    sources,
  };
  const files = sourceFiles.map(({ source, file, bytes }) => {
    const quarantinePath =
      ".cache/rendering-quarantine/" + reviewId + "/" + source.id + "/" + file.relativePath;
    const output = path.join(root, quarantinePath);
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(output, bytes);
    return {
      sourceId: source.id,
      relativePath: file.relativePath,
      directUrl: file.directUrl,
      bytes: bytes.length,
      md5: file.md5,
      sha256: hash(bytes, "sha256"),
      quarantinePath,
    };
  });
  const review = {
    version: 2,
    reviewId,
    sourceSetSha256: sourceLock.sourceSetSha256,
    files,
  };
  writeFileSync(path.join(quarantine, "review.json"), JSON.stringify(review, null, 2));
  return { root, sourceLock, review, quarantine };
}
async function mockWebGlVisuals({ stage, models }: RenderVisualInput) {
  const result = [];
  for (const model of models) {
    const relative = "visuals/models/" + model.sourceId + ".png";
    const output = path.join(stage, relative);
    mkdirSync(path.dirname(output), { recursive: true });
    await sharp({
      create: { width: 32, height: 32, channels: 3, background: { r: 36, g: 70, b: 105 } },
    })
      .png()
      .toFile(output);
    const bytes = readFileSync(output);
    result.push({
      sourceId: model.sourceId,
      kind: "model",
      path: relative,
      bytes: bytes.length,
      sha256: hash(bytes, "sha256"),
      width: 32,
      height: 32,
      renderer: "test-renderer",
    });
  }
  const relative = "visuals/environment-environment-0.png";
  const output = path.join(stage, relative);
  await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 12, g: 28, b: 40 } },
  })
    .png()
    .toFile(output);
  const bytes = readFileSync(output);
  return {
    models: result,
    hdr: {
      sourceId: "environment-0",
      kind: "hdri",
      path: relative,
      bytes: bytes.length,
      sha256: hash(bytes, "sha256"),
      width: 32,
      height: 32,
      renderer: "test-renderer",
    },
    diagnostics: { renderer: "test-renderer", localOnly: true, console: [] },
  };
}

describe("source review packet", () => {
  it("uses local Chromium and Three.js for six glTF views plus one HDRI view", async () => {
    const data = await fixture();
    try {
      const result = await generateSourceReviewPacket({
        root: data.root,
        sourceLock: data.sourceLock,
        review: data.review,
      });
      expect(result.packet.visuals.models).toHaveLength(6);
      expect(
        result.packet.visuals.models.every(
          (view: { renderer: string }) => view.renderer === "three-webgl-playwright",
        ),
      ).toBe(true);
      expect(result.packet.visuals.hdri).toMatchObject({
        sourceId: "environment-0",
        renderer: "three-webgl-playwright",
      });
      expect(result.packet.renderer).toMatchObject({
        renderer: "three-webgl-playwright",
        localOnly: true,
      });
    } finally {
      rmSync(data.root, { recursive: true, force: true });
    }
  }, 90_000);

  it("writes an isolated machine packet only after all 49 quarantined sources validate", async () => {
    const data = await fixture();
    try {
      const result = await generateSourceReviewPacket({
        root: data.root,
        sourceLock: data.sourceLock,
        review: data.review,
        renderVisuals: mockWebGlVisuals,
      });
      expect(result.packet.inventory).toMatchObject({
        expectedFiles: 49,
        reviewedFiles: 49,
        verifiedFiles: 49,
        sourceCounts: { mesh: 6, texture: 4, hdri: 1 },
      });
      expect(result.packet.gltf).toHaveLength(6);
      expect(result.packet.jpeg.length).toBeGreaterThan(0);
      expect(result.packet.visuals.models).toHaveLength(6);
      expect(result.packet.visuals.materials).toHaveLength(4);
      expect(result.packet.visuals.hdri.sourceId).toBe("environment-0");
      expect(existsSync(path.join(result.output, "machine.json"))).toBe(true);
      expect(existsSync(path.join(result.output, "README.md"))).toBe(true);
      expect(existsSync(path.join(data.root, "public", "assets", "rendering"))).toBe(false);
      expect(
        JSON.parse(readFileSync(path.join(result.output, "machine.json"), "utf8")).approval.state,
      ).toBe("awaiting-human-approval");
    } finally {
      rmSync(data.root, { recursive: true, force: true });
    }
  });

  it("fails closed for a glTF data URI and cleans the temporary packet", async () => {
    const data = await fixture("data:application/octet-stream;base64,AAAA");
    try {
      await expect(
        generateSourceReviewPacket({
          root: data.root,
          sourceLock: data.sourceLock,
          review: data.review,
          renderVisuals: mockWebGlVisuals,
        }),
      ).rejects.toThrow(/data, remote, absolute, and escaped URIs/);
      expect(existsSync(path.join(data.quarantine, "review-packet"))).toBe(false);
      expect(
        (existsSync(data.quarantine) ? readdirSync(data.quarantine) : []).some((name: string) =>
          name.startsWith(".review-packet.tmp-"),
        ),
      ).toBe(false);
    } finally {
      rmSync(data.root, { recursive: true, force: true });
    }
  });

  it("rejects missing inventory records and accepts pnpm argument separation", async () => {
    const data = await fixture();
    try {
      data.review.files.pop();
      await expect(
        generateSourceReviewPacket({
          root: data.root,
          sourceLock: data.sourceLock,
          review: data.review,
          renderVisuals: mockWebGlVisuals,
        }),
      ).rejects.toThrow(/exactly 49 files/);
      expect(
        parseSourceReviewPacketArguments([
          "--",
          "--review",
          ".cache/rendering-quarantine/packet-001/review.json",
        ]),
      ).toEqual({
        reviewPath: ".cache/rendering-quarantine/packet-001/review.json",
        sourceLockPath: "public/assets/rendering/sources.lock.json",
      });
    } finally {
      rmSync(data.root, { recursive: true, force: true });
    }
  });
});
