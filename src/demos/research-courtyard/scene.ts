import type {
  CourtyardAssetLoader,
  CourtyardBox,
  CourtyardMaterial,
  CourtyardScene,
  RenderingAssetManifest,
  RenderingAssetRecord,
} from "./types";

export const RESEARCH_COURTYARD_MANIFEST_PATH =
  "/assets/rendering/manifests/research-courtyard.json";

const MATERIALS: CourtyardMaterial[] = [
  { id: "worn-concrete", albedo: [0.34, 0.35, 0.33], roughness: 0.9, metalness: 0 },
  { id: "rusted-steel", albedo: [0.36, 0.12, 0.055], roughness: 0.58, metalness: 0.86 },
  { id: "signal-paint", albedo: [0.95, 0.48, 0.08], roughness: 0.42, metalness: 0.08 },
  { id: "mint-screen", albedo: [0.08, 0.68, 0.56], roughness: 0.32, metalness: 0.2 },
];

/** CPU-built scene used until the auditable processed pack is present. */
export function buildProceduralResearchCourtyard(): CourtyardScene {
  const boxes: CourtyardBox[] = [
    { id: "floor", center: [0, -0.35, 6], size: [16, 0.25, 16], materialId: "worn-concrete" },
    { id: "rear-wall", center: [0, 3.2, 13], size: [16, 7, 0.35], materialId: "worn-concrete" },
    { id: "left-wall", center: [-7.8, 3.2, 6], size: [0.35, 7, 14], materialId: "worn-concrete" },
    { id: "right-wall", center: [7.8, 3.2, 6], size: [0.35, 7, 14], materialId: "worn-concrete" },
    { id: "plinth", center: [0, 0.55, 6.2], size: [2.4, 1.5, 2.4], materialId: "rusted-steel" },
    {
      id: "signal-pillar-a",
      center: [-3.2, 1.4, 4.1],
      size: [0.46, 3.2, 0.46],
      materialId: "signal-paint",
    },
    {
      id: "signal-pillar-b",
      center: [3.2, 1.4, 4.1],
      size: [0.46, 3.2, 0.46],
      materialId: "signal-paint",
    },
    { id: "screen-bank", center: [0, 2.2, 10.2], size: [4.2, 2.3, 0.3], materialId: "mint-screen" },
  ];
  for (const x of [-5.8, -3.9, 3.9, 5.8]) {
    boxes.push({
      id: `colonnade-${x}`,
      center: [x, 1.95, 8.2],
      size: [0.52, 4.1, 0.52],
      materialId: "worn-concrete",
    });
  }
  return {
    source: "procedural",
    boxes,
    materials: MATERIALS.map((entry) => ({ ...entry })),
    assetIds: [],
  };
}

export function isRenderingAssetRecord(value: unknown): value is RenderingAssetRecord {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<RenderingAssetRecord>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.path === "string" &&
    typeof candidate.outputSha256 === "string" &&
    Array.isArray(candidate.authors) &&
    Array.isArray(candidate.usedBy) &&
    (candidate.license === "self-authored" || candidate.license === "CC0")
  );
}

export function isRenderingAssetManifest(value: unknown): value is RenderingAssetManifest {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<RenderingAssetManifest>;
  return (
    candidate.version === 1 &&
    Array.isArray(candidate.assets) &&
    candidate.assets.every(isRenderingAssetRecord)
  );
}

/** Missing manifest intentionally keeps the self-authored procedural scene. */
export async function loadResearchCourtyardManifest(
  loader: CourtyardAssetLoader,
  path = RESEARCH_COURTYARD_MANIFEST_PATH,
): Promise<RenderingAssetManifest | undefined> {
  const manifest = await loader.loadManifest(path);
  return manifest && isRenderingAssetManifest(manifest) ? manifest : undefined;
}
