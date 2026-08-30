import type { PassDesc, RenderGraphDefinition } from "./core";

const RESOURCES: RenderGraphDefinition["resources"] = [
  { id: "scene", kind: "buffer", format: "scene-data-v1", size: 4_096, external: true },
  { id: "depth", kind: "texture", format: "depth24plus", width: 1280, height: 720 },
  { id: "normal", kind: "texture", format: "rgba16float", width: 1280, height: 720 },
  { id: "albedo", kind: "texture", format: "rgba8unorm", width: 1280, height: 720 },
  { id: "velocity", kind: "texture", format: "rg16float", width: 1280, height: 720 },
  { id: "ao", kind: "texture", format: "r8unorm", width: 1280, height: 720 },
  { id: "hdr", kind: "texture", format: "rgba16float", width: 1280, height: 720 },
  {
    id: "history",
    kind: "texture",
    format: "rgba16float",
    width: 1280,
    height: 720,
    external: true,
    persistent: true,
  },
  {
    id: "present",
    kind: "texture",
    format: "bgra8unorm",
    width: 1280,
    height: 720,
    external: true,
    present: true,
  },
  { id: "debug-grid", kind: "texture", format: "rgba8unorm", width: 1280, height: 720 },
];

const PASSES: PassDesc[] = [
  {
    id: "depth",
    label: "DEPTH PREPASS",
    reads: [{ resource: "scene", usage: "storage-read" }],
    writes: [{ resource: "depth", usage: "depth-attachment" }],
  },
  {
    id: "gbuffer",
    label: "G-BUFFER",
    reads: [{ resource: "depth", usage: "depth-attachment" }],
    writes: [
      { resource: "normal", usage: "render-attachment" },
      { resource: "albedo", usage: "render-attachment" },
      { resource: "velocity", usage: "render-attachment" },
    ],
  },
  {
    id: "ssao",
    label: "SSAO",
    reads: [
      { resource: "depth", usage: "sampled" },
      { resource: "normal", usage: "sampled" },
    ],
    writes: [{ resource: "ao", usage: "render-attachment" }],
  },
  {
    id: "lighting",
    label: "LIGHTING",
    reads: [
      { resource: "depth", usage: "sampled" },
      { resource: "normal", usage: "sampled" },
      { resource: "albedo", usage: "sampled" },
      { resource: "ao", usage: "sampled" },
    ],
    writes: [{ resource: "hdr", usage: "render-attachment" }],
  },
  {
    id: "taa",
    label: "TEMPORAL RESOLVE",
    reads: [
      { resource: "hdr", usage: "sampled" },
      { resource: "velocity", usage: "sampled" },
      { resource: "history", usage: "sampled" },
    ],
    writes: [{ resource: "history", usage: "render-attachment" }],
  },
  {
    id: "tone",
    label: "PRESENT",
    reads: [{ resource: "history", usage: "sampled" }],
    writes: [{ resource: "present", usage: "present" }],
    sideEffect: true,
  },
  {
    id: "debug-overlay",
    label: "DEBUG OVERLAY",
    reads: [{ resource: "hdr", usage: "sampled" }],
    writes: [{ resource: "debug-grid", usage: "render-attachment" }],
  },
];

export function createRenderGraphDefinition(enabled: ReadonlySet<string>): RenderGraphDefinition {
  return {
    passes: PASSES.map((pass) => ({
      ...pass,
      enabled: enabled.has(pass.id),
      reads: pass.reads?.map((access) => ({ ...access })),
      writes: pass.writes?.map((access) => ({ ...access })),
    })),
    resources: RESOURCES.map((resource) => ({ ...resource })),
  };
}

export const renderGraphPasses = PASSES.map(({ id, label }) => ({ id, label }));
