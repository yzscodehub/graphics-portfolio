import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { afterEach, describe, expect, it } from "vitest";

import {
  assembleResearchCourtyardScene,
  createArchitectureBox,
  loadResearchCourtyardLodCandidate,
  ResearchCourtyardSceneError,
} from "../scripts/assets/research-courtyard-scene.mjs";
import { parsePackedSceneV2 } from "../src/demos/research-courtyard/packed-scene-v2";

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stable(child)]),
  );
}

function digest(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function primitive(nodeName: string, triangles: number) {
  const vertexCount = triangles + 2;
  const positions = Array.from({ length: vertexCount }, (_, index) => [
    index % 2,
    Math.floor(index / 2),
    nodeName === "detail" ? 0.25 : 0,
  ]).flat();
  return {
    sourceId: "fixture",
    partId: "main",
    nodeName,
    primitiveIndex: 0,
    positions,
    normals: Array.from({ length: vertexCount }, () => [0, 0, 1]).flat(),
    tangents: Array.from({ length: vertexCount }, () => [1, 0, 0, 1]).flat(),
    uvs: Array.from({ length: vertexCount }, (_, index) => [
      index % 2,
      Math.floor(index / 2),
    ]).flat(),
    indices: Array.from({ length: triangles }, (_, index) => [0, index + 1, index + 2]).flat(),
    material: {
      name: "fixture-material",
      alphaMode: "OPAQUE",
      alphaCutoff: 0.5,
      doubleSided: false,
      baseColorFactor: [0.8, 0.7, 0.6, 1],
      emissiveFactor: [0, 0, 0],
      metallicFactor: 0.1,
      roughnessFactor: 0.8,
      normalScale: 1,
      textureTransform: null,
    },
  };
}

function geometry(primitives: ReturnType<typeof primitive>[]) {
  return {
    sourceId: "fixture",
    parts: [
      {
        partId: "main",
        primitives,
      },
    ],
  };
}

function recipe() {
  return {
    meshSources: [
      {
        sourceId: "fixture",
        parts: [{ partId: "main", nodeNames: ["body", "detail"] }],
        lod: {
          ratios: [1, 0.5, 0.2],
          maxErrors: [0, 0.01, 0.05],
          requireStrictDecrease: true,
          lod2DropNodeNames: ["detail"],
        },
        materialOverrides: [],
      },
    ],
    materialSources: [
      {
        materialId: "concrete",
        metallicFactor: 0,
      },
    ],
    architecture: [
      {
        id: "wall",
        primitive: "box",
        center: [0, 1, 0],
        size: [2, 2, 0.25],
        materialId: "concrete",
        uvMetersPerRepeat: 1,
      },
    ],
    instances: [
      {
        instanceId: "fixture-instance",
        sourceId: "fixture",
        partId: "main",
        translation: [2, 0, 3],
        rotationYDegrees: 90,
        scale: [2, 1, 2],
        animation: {
          kind: "spin-y",
          radiansPerSecond: 0.35,
          phaseRadians: 0,
          writesPreviousTransform: true,
        },
      },
    ],
  };
}

function textures() {
  return {
    textures: [
      {
        id: "base",
        colorSpace: "srgb",
        ktx2: "textures/base.ktx2",
        webp: "textures/base.webp",
      },
      {
        id: "normal",
        colorSpace: "linear",
        ktx2: "textures/normal.ktx2",
        webp: "textures/normal.webp",
      },
      {
        id: "orm",
        colorSpace: "linear",
        ktx2: "textures/orm.ktx2",
        webp: "textures/orm.webp",
      },
    ],
    materials: {
      "fixture:fixture-material": {
        baseColor: "base",
        normal: "normal",
        orm: "orm",
      },
      "architecture:concrete": {
        baseColor: "base",
        normal: "normal",
        orm: "orm",
      },
    },
  };
}

function geometries() {
  const detail = primitive("detail", 1);
  return {
    fixture: [
      geometry([primitive("body", 4), detail]),
      geometry([primitive("body", 2), detail]),
      geometry([primitive("body", 1)]),
    ],
  };
}

function lodCandidate() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "courtyard-scene-lods-"));
  temporary.push(directory);
  const files: Array<{ path: string; bytes: number; sha256: string }> = [];
  geometries().fixture.forEach((geometry, level) => {
    const relative = `geometry/fixture/lod${level}.json.gz`;
    const file = path.join(directory, ...relative.split("/"));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, gzipSync(Buffer.from(JSON.stringify(geometry)), { level: 9 }));
    files.push({
      path: relative,
      bytes: statSync(file).size,
      sha256: digest(readFileSync(file)),
    });
  });
  files.sort((left, right) => left.path.localeCompare(right.path));
  const candidateArtifactsSha256 = digest(`${JSON.stringify(stable(files), null, 2)}\n`);
  writeFileSync(
    path.join(directory, "lod-candidate.manifest.json"),
    JSON.stringify({
      format: "graphics-portfolio-research-courtyard-lods",
      version: 1,
      status: "candidate",
      publishable: false,
      sourceSetSha256: "a".repeat(64),
      recipeSha256: "b".repeat(64),
      candidateArtifactsSha256,
      files,
      sources: [{ sourceId: "fixture", lods: [] }],
    }),
  );
  return directory;
}

describe("Research Courtyard scene assembler", () => {
  it("builds box faces with outward winding, tangent frames, and metric UVs", () => {
    const box = createArchitectureBox(recipe().architecture[0]);
    expect(box.positions).toHaveLength(24 * 3);
    expect(box.normals).toHaveLength(24 * 3);
    expect(box.tangents).toHaveLength(24 * 4);
    expect(box.indices).toHaveLength(36);
    const [a, b, c] = box.indices
      .slice(0, 3)
      .map((index: number) => box.positions.slice(index * 3, index * 3 + 3));
    const edgeA = b.map((value: number, index: number) => value - a[index]);
    const edgeB = c.map((value: number, index: number) => value - a[index]);
    const normal = [
      edgeA[1] * edgeB[2] - edgeA[2] * edgeB[1],
      edgeA[2] * edgeB[0] - edgeA[0] * edgeB[2],
      edgeA[0] * edgeB[1] - edgeA[1] * edgeB[0],
    ];
    expect(normal[0]).toBeGreaterThan(0);
  });

  it("assembles architecture, mixed real LODs, explicit culls, and animated instances", async () => {
    const scene = await assembleResearchCourtyardScene({
      recipe: recipe(),
      geometriesBySource: geometries(),
      textureCatalog: textures(),
    });
    const pack = parsePackedSceneV2(scene.pack);
    expect(scene.counts).toMatchObject({
      meshes: 3,
      modelMeshes: 2,
      architectureMeshes: 1,
      materials: 2,
      instances: 3,
      animatedInstances: 2,
    });
    expect(pack.meshes.map((mesh) => mesh.lodPolicy).sort()).toEqual([
      "culled-at-lod2",
      "preserved",
      "simplified",
    ]);
    expect(pack.meshes.flatMap((mesh) => mesh.lods).some((lod) => lod.state === "culled")).toBe(
      true,
    );
    expect(pack.instances.filter((instance) => instance.animation !== null)).toHaveLength(2);
    expect(pack.instances.every((instance, index) => instance.id.endsWith(`:${index}`))).toBe(true);
    expect(new DataView(scene.buffers.indirect).getUint32(16, true)).toBe(0);
  });

  it("fails closed on missing LOD identities and incomplete texture bindings", async () => {
    const missing = geometries();
    missing.fixture[1] = geometry([primitive("body", 2)]);
    await expect(
      assembleResearchCourtyardScene({
        recipe: recipe(),
        geometriesBySource: missing,
        textureCatalog: textures(),
      }),
    ).rejects.toBeInstanceOf(ResearchCourtyardSceneError);

    const catalog = textures();
    delete (catalog.materials as Record<string, unknown>)["fixture:fixture-material"];
    await expect(
      assembleResearchCourtyardScene({
        recipe: recipe(),
        geometriesBySource: geometries(),
        textureCatalog: catalog,
      }),
    ).rejects.toThrow(/textureCatalog.materials/);
  });

  it("loads only hash-bound normalized LOD candidate geometry", () => {
    const directory = lodCandidate();
    const loaded = loadResearchCourtyardLodCandidate(directory, {
      sourceSetSha256: "a".repeat(64),
      recipeSha256: "b".repeat(64),
    });
    expect((loaded.geometriesBySource as Record<string, unknown[]>).fixture).toHaveLength(3);
    const file = path.join(directory, "geometry/fixture/lod1.json.gz");
    writeFileSync(file, Buffer.from("tampered"));
    expect(() =>
      loadResearchCourtyardLodCandidate(directory, {
        sourceSetSha256: "a".repeat(64),
        recipeSha256: "b".repeat(64),
      }),
    ).toThrow(/candidate bytes/);
  });
});
