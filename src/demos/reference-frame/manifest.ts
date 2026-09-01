/**
 * The Reference Frame's executable pass/resource contract. This file owns the
 * names, usages, attachment provenance, and order used by the renderer and by
 * Render Graph Explorer's primary preset.
 */
export type ReferenceFrameUsage = "depth-attachment" | "present" | "render-attachment" | "sampled";

export interface ReferenceFrameResourceManifest {
  id: string;
  format: string;
  external?: boolean;
  persistent?: boolean;
  present?: boolean;
  attachmentView?: string;
  lastWriter: string;
}

export interface ReferenceFrameAccessManifest {
  resource: string;
  usage: ReferenceFrameUsage;
}

export interface ReferenceFramePassManifest {
  id: string;
  label: string;
  rendererLabel: string;
  sideEffect?: boolean;
  reads: readonly ReferenceFrameAccessManifest[];
  writes: readonly ReferenceFrameAccessManifest[];
}

export interface ReferenceFrameAttachmentFact {
  view: string;
  resource: string;
  label: string;
  format: string;
  range: string;
  lastWriter: string;
}

export const referenceFrameResources: readonly ReferenceFrameResourceManifest[] = [
  { id: "shadow-depth", format: "r32float", lastWriter: "Shadow Map" },
  { id: "albedo-metalness", format: "rgba8unorm", attachmentView: "albedo", lastWriter: "GBuffer" },
  {
    id: "normal-roughness",
    format: "rgba16float",
    attachmentView: "normal",
    lastWriter: "GBuffer",
  },
  { id: "velocity", format: "rg16float", attachmentView: "velocity", lastWriter: "GBuffer" },
  { id: "linear-depth", format: "r32float", attachmentView: "depth", lastWriter: "GBuffer" },
  { id: "device-depth", format: "depth32float", lastWriter: "GBuffer" },
  {
    id: "cluster-light-count",
    format: "r8unorm",
    attachmentView: "cluster-light-count",
    lastWriter: "ReferenceFrame / Local Cluster Count",
  },
  {
    id: "lighting",
    format: "rgba16float",
    attachmentView: "lighting",
    lastWriter: "Deferred Lighting",
  },
  { id: "ssao", format: "r8unorm", attachmentView: "ssao", lastWriter: "SSAO" },
  {
    id: "history",
    format: "rgba16float",
    external: true,
    persistent: true,
    attachmentView: "history",
    lastWriter: "Temporal Resolve",
  },
  {
    id: "history-depth",
    format: "r32float",
    external: true,
    persistent: true,
    lastWriter: "Temporal Resolve",
  },
  {
    id: "history-reject",
    format: "r8unorm",
    attachmentView: "history-reject",
    lastWriter: "Temporal Resolve / Reject Mask",
  },
  {
    id: "present",
    format: "preferred-canvas-format",
    external: true,
    present: true,
    attachmentView: "final",
    lastWriter: "Display / Tone Map",
  },
] as const;

export const referenceFramePasses: readonly ReferenceFramePassManifest[] = [
  {
    id: "shadow-map",
    label: "SHADOW MAP",
    rendererLabel: "ReferenceFrame/ShadowMapPass",
    reads: [],
    writes: [{ resource: "shadow-depth", usage: "render-attachment" }],
  },
  {
    id: "gbuffer",
    label: "G-BUFFER",
    rendererLabel: "ReferenceFrame/GBufferPass",
    reads: [],
    writes: [
      { resource: "albedo-metalness", usage: "render-attachment" },
      { resource: "normal-roughness", usage: "render-attachment" },
      { resource: "velocity", usage: "render-attachment" },
      { resource: "linear-depth", usage: "render-attachment" },
      { resource: "device-depth", usage: "depth-attachment" },
    ],
  },
  {
    id: "cluster-light-count",
    label: "CLUSTER LIGHT COUNT",
    rendererLabel: "ReferenceFrame/ClusterLightCountPass",
    reads: [{ resource: "linear-depth", usage: "sampled" }],
    writes: [{ resource: "cluster-light-count", usage: "render-attachment" }],
  },
  {
    id: "lighting",
    label: "DEFERRED LIGHTING",
    rendererLabel: "ReferenceFrame/LightingPass",
    reads: [
      { resource: "albedo-metalness", usage: "sampled" },
      { resource: "normal-roughness", usage: "sampled" },
      { resource: "linear-depth", usage: "sampled" },
      { resource: "shadow-depth", usage: "sampled" },
    ],
    writes: [{ resource: "lighting", usage: "render-attachment" }],
  },
  {
    id: "ssao",
    label: "SSAO",
    rendererLabel: "ReferenceFrame/SSAOPass",
    reads: [
      { resource: "linear-depth", usage: "sampled" },
      { resource: "normal-roughness", usage: "sampled" },
    ],
    writes: [{ resource: "ssao", usage: "render-attachment" }],
  },
  {
    id: "temporal-resolve",
    label: "TEMPORAL RESOLVE",
    rendererLabel: "ReferenceFrame/ResolvePass",
    reads: [
      { resource: "lighting", usage: "sampled" },
      { resource: "velocity", usage: "sampled" },
      { resource: "linear-depth", usage: "sampled" },
      { resource: "history", usage: "sampled" },
      { resource: "history-depth", usage: "sampled" },
    ],
    writes: [
      { resource: "history", usage: "render-attachment" },
      { resource: "history-depth", usage: "render-attachment" },
      { resource: "history-reject", usage: "render-attachment" },
    ],
  },
  {
    id: "display",
    label: "DISPLAY",
    rendererLabel: "ReferenceFrame/DisplayPass",
    sideEffect: true,
    reads: [
      { resource: "albedo-metalness", usage: "sampled" },
      { resource: "normal-roughness", usage: "sampled" },
      { resource: "linear-depth", usage: "sampled" },
      { resource: "velocity", usage: "sampled" },
      { resource: "lighting", usage: "sampled" },
      { resource: "ssao", usage: "sampled" },
      { resource: "history", usage: "sampled" },
      { resource: "history-reject", usage: "sampled" },
      { resource: "cluster-light-count", usage: "sampled" },
    ],
    writes: [{ resource: "present", usage: "present" }],
  },
] as const;

export const referenceFrameAttachments: readonly ReferenceFrameAttachmentFact[] = [
  {
    view: "final",
    resource: "present",
    label: "FINAL",
    format: "preferred-canvas-format",
    range: "display-referred / browser preferred canvas format",
    lastWriter: "Display / Tone Map",
  },
  {
    view: "albedo",
    resource: "albedo-metalness",
    label: "ALBEDO + METALNESS",
    format: "rgba8unorm",
    range: "RGB [0,1], A metalness (right strip)",
    lastWriter: "GBuffer",
  },
  {
    view: "normal",
    resource: "normal-roughness",
    label: "NORMAL + ROUGHNESS",
    format: "rgba16float",
    range: "RGB encoded [-1,1], A roughness (right strip)",
    lastWriter: "GBuffer",
  },
  {
    view: "depth",
    resource: "linear-depth",
    label: "LINEAR DEPTH",
    format: "r32float",
    range: "view distance / 12",
    lastWriter: "GBuffer",
  },
  {
    view: "velocity",
    resource: "velocity",
    label: "VELOCITY",
    format: "rg16float",
    range: "screen UV delta",
    lastWriter: "GBuffer",
  },
  {
    view: "lighting",
    resource: "lighting",
    label: "HDR LIGHTING",
    format: "rgba16float",
    range: "linear HDR",
    lastWriter: "Deferred Lighting",
  },
  {
    view: "ssao",
    resource: "ssao",
    label: "SSAO",
    format: "r8unorm",
    range: "occlusion [0,1]",
    lastWriter: "SSAO",
  },
  {
    view: "history",
    resource: "history",
    label: "TAA HISTORY",
    format: "rgba16float",
    range: "linear HDR / latest Temporal Resolve; Inspector applies ACES + sRGB only for display",
    lastWriter: "Temporal Resolve",
  },
  {
    view: "history-reject",
    resource: "history-reject",
    label: "HISTORY REJECT",
    format: "r8unorm",
    range: "1.0 = no valid history, UV bounds reject, or depth reject; 0.0 = accepted history",
    lastWriter: "Temporal Resolve / Reject Mask",
  },
  {
    view: "cluster-light-count",
    resource: "cluster-light-count",
    label: "CLUSTER LIGHT COUNT",
    format: "r8unorm",
    range: "normalized [0,1] = Reference Frame local proxy count [0,8] / 8",
    lastWriter: "ReferenceFrame / Local Cluster Count",
  },
] as const;

export function referenceFramePass(passId: string): ReferenceFramePassManifest {
  const pass = referenceFramePasses.find((entry) => entry.id === passId);
  if (!pass) throw new Error(`Unknown Reference Frame pass '${passId}'.`);
  return pass;
}
