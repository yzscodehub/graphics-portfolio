export type ReferenceView =
  "final" | "albedo" | "normal" | "depth" | "velocity" | "lighting" | "ssao" | "history";

export type ShadowTechnique = "hard" | "pcf" | "pcss";
export type AaTechnique = "none" | "fxaa" | "taa";

export interface AttachmentInfo {
  view: ReferenceView;
  label: string;
  format: GPUTextureFormat | "preferred-canvas-format";
  range: string;
  lastWriter: string;
}

export const REFERENCE_ATTACHMENTS: readonly AttachmentInfo[] = [
  {
    view: "final",
    label: "FINAL",
    format: "preferred-canvas-format",
    range: "display-referred / browser preferred canvas format",
    lastWriter: "Display / Tone Map",
  },
  {
    view: "albedo",
    label: "ALBEDO + METALNESS",
    format: "rgba8unorm",
    range: "RGB [0,1], A metalness (right strip)",
    lastWriter: "GBuffer",
  },
  {
    view: "normal",
    label: "NORMAL + ROUGHNESS",
    format: "rgba16float",
    range: "RGB encoded [-1,1], A roughness (right strip)",
    lastWriter: "GBuffer",
  },
  {
    view: "depth",
    label: "LINEAR DEPTH",
    format: "r32float",
    range: "view distance / 12",
    lastWriter: "GBuffer",
  },
  {
    view: "velocity",
    label: "VELOCITY",
    format: "rg16float",
    range: "screen UV delta",
    lastWriter: "GBuffer",
  },
  {
    view: "lighting",
    label: "HDR LIGHTING",
    format: "rgba16float",
    range: "linear HDR",
    lastWriter: "Deferred Lighting",
  },
  {
    view: "ssao",
    label: "SSAO",
    format: "r8unorm",
    range: "occlusion [0,1]",
    lastWriter: "SSAO",
  },
  {
    view: "history",
    label: "TAA HISTORY",
    format: "rgba16float",
    range: "linear HDR / latest Temporal Resolve (ACES + sRGB display transform)",
    lastWriter: "Temporal Resolve",
  },
] as const;

export function attachmentInfo(view: ReferenceView): AttachmentInfo {
  return REFERENCE_ATTACHMENTS.find((entry) => entry.view === view) ?? REFERENCE_ATTACHMENTS[0];
}
