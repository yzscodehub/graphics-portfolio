import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const placeholderPackPath = path.join(
  root,
  "public/assets/rendering/packs/research-courtyard.pack.json",
);
export const calibrationRigContractPath = path.join(
  root,
  "public/assets/rendering/contracts/calibration-rig.contract.json",
);
export const cornellSceneContractPath = path.join(
  root,
  "public/assets/rendering/contracts/cornell-scene.contract.json",
);
export const researchCourtyardRuntimeManifestPath = path.join(
  root,
  "public/assets/rendering/manifests/research-courtyard.json",
);

const pillar = (x, z) => ({
  meshId: "arcade-pillar",
  material: "concrete",
  transform: [1, 0, 0, x, 0, 1, 0, 0, 0, 0, 1, z],
});

export function createResearchCourtyardPlaceholderPack() {
  return {
    format: "graphics-portfolio-packed-scene",
    version: 1,
    generator: "scripts/assets/build-placeholder-pack.mjs",
    placeholder: true,
    notice:
      "Self-authored deterministic procedural placeholder. It documents the production packed-scene contract and is not the later reviewed Meshopt/KTX2 scene.",
    coordinateSystem: "right-handed-y-up-meters",
    vertexLayout: {
      strideBytes: 32,
      attributes: [
        { semantic: "POSITION", format: "float32x3", offsetBytes: 0 },
        { semantic: "NORMAL_OCT", format: "snorm16x2", offsetBytes: 12 },
        { semantic: "TANGENT", format: "snorm16x4", offsetBytes: 16 },
        { semantic: "TEXCOORD_0", format: "float16x2", offsetBytes: 24 },
        { semantic: "PADDING", format: "uint32", offsetBytes: 28 },
      ],
    },
    indexFormat: "uint32",
    materialLayout: {
      factors: ["baseColor", "metallic", "roughness"],
      textureIndex: "uint32",
      alphaModes: ["OPAQUE", "MASK"],
      doubleSided: "bool",
    },
    indirectCommand: { alignmentBytes: 32, firstInstance: 0 },
    meshes: [
      {
        id: "courtyard-floor",
        vertexCount: 4,
        indexCount: 6,
        baseVertex: 0,
        indexOffset: 0,
        bounds: { center: [0, 0, 0], radius: 9.9 },
        lod: { lod0Triangles: 2, lod1Triangles: 2, lod2Triangles: 2 },
      },
      {
        id: "arcade-pillar",
        vertexCount: 8,
        indexCount: 36,
        baseVertex: 4,
        indexOffset: 6,
        bounds: { center: [0, 2.5, 0], radius: 2.7 },
        lod: { lod0Triangles: 12, lod1Triangles: 8, lod2Triangles: 4 },
      },
    ],
    instances: [
      {
        meshId: "courtyard-floor",
        material: "concrete",
        transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
      },
      pillar(-6, -4),
      pillar(6, -4),
      pillar(-6, 4),
      pillar(6, 4),
    ],
    renderPasses: {
      deferredOpaque: ["courtyard-floor", "arcade-pillar"],
      alphaMaskForward: [],
      notes:
        "The future chain-link fence is reserved for alpha-mask forward rendering and must not be added to deferred opaque.",
    },
  };
}

export function renderResearchCourtyardPlaceholderPack() {
  return `${JSON.stringify(createResearchCourtyardPlaceholderPack(), null, 2)}\n`;
}

export function rebuildResearchCourtyardPlaceholderPack(file = placeholderPackPath) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, renderResearchCourtyardPlaceholderPack(), "utf8");
}

export function createCalibrationRigContract() {
  return {
    format: "graphics-portfolio-scene-contract",
    version: 1,
    assetId: "calibration-rig",
    generator: "scripts/assets/build-placeholder-pack.mjs",
    coordinateSystem: "right-handed-y-up-meters",
    geometry: [
      "calibration-sphere",
      "beveled-cube",
      "roughness-plane",
      "metal-ring",
      "thin-sheet",
      "normal-groove",
    ],
    materials: ["dielectric", "metal", "rough", "clearcoat"],
    debugAttachments: ["final", "normal", "roughness", "metalness", "direct", "indirect"],
    externalAssets: false,
  };
}

export function createCornellSceneContract() {
  return {
    format: "graphics-portfolio-scene-contract",
    version: 1,
    assetId: "cornell-scene",
    generator: "scripts/assets/build-placeholder-pack.mjs",
    coordinateSystem: "right-handed-y-up-meters",
    primitives: [
      "walls",
      "rectangular-light",
      "diffuse-sphere",
      "metal-sphere",
      "dielectric-sphere",
    ],
    acceleration: { builder: "cpu-median-split-bvh", traversal: "wgsl-fixed-stack" },
    transport: { maxBounces: 4, accumulation: "rgba16float-linear" },
    externalAssets: false,
  };
}

export function renderCalibrationRigContract() {
  return `${JSON.stringify(createCalibrationRigContract(), null, 2)}\n`;
}

export function renderCornellSceneContract() {
  return `${JSON.stringify(createCornellSceneContract(), null, 2)}\n`;
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function writeContract(file, contents) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents, "utf8");
}

export function rebuildPlaceholderRenderingAssets() {
  rebuildResearchCourtyardPlaceholderPack();
  writeContract(calibrationRigContractPath, renderCalibrationRigContract());
  writeContract(cornellSceneContractPath, renderCornellSceneContract());
  const record = {
    id: "research-courtyard",
    kind: "scene",
    role: "packed-scene-placeholder",
    path: "public/assets/rendering/packs/research-courtyard.pack.json",
    sourceUrl: null,
    authors: ["yzscodehub"],
    license: "self-authored",
    sourceSha256: null,
    outputSha256: sha256(placeholderPackPath),
    bytes: statSync(placeholderPackPath).size,
    triangles: 14,
    lodTriangles: [14, 10, 6],
    usedBy: ["clustered-lighting", "gpu-particles", "shadow-aa", "frame-inspector"],
  };
  writeContract(
    researchCourtyardRuntimeManifestPath,
    `${JSON.stringify({ version: 1, assets: [record] }, null, 2)}\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  rebuildPlaceholderRenderingAssets();
  console.log("Wrote deterministic rendering placeholder assets.");
}
