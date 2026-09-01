import {
  referenceFramePasses,
  referenceFrameResources,
  type ReferenceFrameAccessManifest,
} from "../reference-frame/manifest";
import type { Access, PassDesc, RenderGraphDefinition, ResourceDesc, ResourceUsage } from "./core";

const REFERENCE_WIDTH = 1280;
const REFERENCE_HEIGHT = 720;

/**
 * A deliberately synthetic, unconsumed pass keeps Pass Culling observable in
 * the Explorer. Every other resource/pass is derived from Reference Frame.
 */
const diagnosticCullingResource: ResourceDesc = {
  id: "diagnostic-debug-grid",
  kind: "texture",
  format: "rgba8unorm",
  width: REFERENCE_WIDTH,
  height: REFERENCE_HEIGHT,
};

const diagnosticCullingPass: PassDesc = {
  id: "diagnostic-debug-overlay",
  label: "DIAGNOSTIC DEBUG OVERLAY",
  reads: [{ resource: "lighting", usage: "sampled" }],
  writes: [{ resource: "diagnostic-debug-grid", usage: "render-attachment" }],
};

function access(entry: ReferenceFrameAccessManifest): Access {
  return { resource: entry.resource, usage: entry.usage as ResourceUsage };
}

function resource(entry: (typeof referenceFrameResources)[number]): ResourceDesc {
  return {
    id: entry.id,
    kind: "texture",
    format: entry.format,
    width: REFERENCE_WIDTH,
    height: REFERENCE_HEIGHT,
    ...(entry.external ? { external: true } : {}),
    ...(entry.persistent ? { persistent: true } : {}),
    ...(entry.present ? { present: true } : {}),
  };
}

function pass(entry: (typeof referenceFramePasses)[number]): PassDesc {
  return {
    id: entry.id,
    label: entry.label,
    ...(entry.sideEffect ? { sideEffect: true } : {}),
    reads: entry.reads.map(access),
    writes: entry.writes.map(access),
  };
}

export const referenceFrameRenderGraphPasses = referenceFramePasses.map((entry) => pass(entry));
export const referenceFrameRenderGraphResources = referenceFrameResources.map((entry) =>
  resource(entry),
);

export function createReferenceFrameRenderGraphDefinition(
  enabled: ReadonlySet<string>,
): RenderGraphDefinition {
  return {
    passes: referenceFrameRenderGraphPasses.map((entry) => ({
      ...entry,
      enabled: enabled.has(entry.id),
      reads: entry.reads?.map((item) => ({ ...item })),
      writes: entry.writes?.map((item) => ({ ...item })),
    })),
    resources: referenceFrameRenderGraphResources.map((entry) => ({ ...entry })),
  };
}

export function createRenderGraphDefinition(enabled: ReadonlySet<string>): RenderGraphDefinition {
  const definition = createReferenceFrameRenderGraphDefinition(enabled);
  return {
    ...definition,
    resources: [...definition.resources, { ...diagnosticCullingResource }],
    passes: [
      ...definition.passes,
      {
        ...diagnosticCullingPass,
        enabled: enabled.has(diagnosticCullingPass.id),
        reads: diagnosticCullingPass.reads?.map((item) => ({ ...item })),
        writes: diagnosticCullingPass.writes?.map((item) => ({ ...item })),
      },
    ],
  };
}

export const renderGraphPasses = [
  ...referenceFramePasses.map(({ id, label }) => ({ id, label })),
  { id: diagnosticCullingPass.id, label: diagnosticCullingPass.label },
];
