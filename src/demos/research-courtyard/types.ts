import type {
  RenderingAssetManifest as SharedRenderingAssetManifest,
  RenderingAssetRecord as SharedRenderingAssetRecord,
} from "../../data/rendering-assets";

export type RenderingAssetRecord = SharedRenderingAssetRecord;
export type RenderingAssetManifest = SharedRenderingAssetManifest;

export interface CourtyardMaterial {
  id: string;
  albedo: readonly [number, number, number];
  roughness: number;
  metalness: number;
}

export interface CourtyardBox {
  id: string;
  center: readonly [number, number, number];
  size: readonly [number, number, number];
  materialId: string;
}

export interface CourtyardScene {
  source: "procedural" | "packed-asset";
  boxes: CourtyardBox[];
  materials: CourtyardMaterial[];
  assetIds: string[];
}

export interface CourtyardAssetLoader {
  loadManifest(path: string): Promise<RenderingAssetManifest | undefined>;
}
