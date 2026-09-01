import { describe, expect, it } from "vitest";
import {
  referenceFrameAttachments,
  referenceFramePasses,
  referenceFrameResources,
} from "../src/demos/reference-frame/manifest";
import { attachmentInfo, type ReferenceView } from "../src/demos/reference-frame/types";
import { compileRenderGraph } from "../src/demos/render-graph/core";
import {
  createReferenceFrameRenderGraphDefinition,
  createRenderGraphDefinition,
  referenceFrameRenderGraphPasses,
  referenceFrameRenderGraphResources,
  renderGraphPasses,
} from "../src/demos/render-graph/demo-definition";

describe("Reference Frame / Render Graph contract", () => {
  const enabledReferencePasses = new Set(referenceFramePasses.map((pass) => pass.id));

  it("derives the primary Explorer preset from every real Reference Frame pass and resource", () => {
    const definition = createReferenceFrameRenderGraphDefinition(enabledReferencePasses);
    expect(definition.passes.map((pass) => pass.id)).toEqual(
      referenceFramePasses.map((pass) => pass.id),
    );
    expect(definition.resources.map((resource) => resource.id)).toEqual(
      referenceFrameResources.map((resource) => resource.id),
    );
    expect(referenceFrameRenderGraphPasses.map((pass) => pass.id)).toEqual(
      referenceFramePasses.map((pass) => pass.id),
    );
    expect(referenceFrameRenderGraphResources.map((resource) => resource.id)).toEqual(
      referenceFrameResources.map((resource) => resource.id),
    );
    referenceFramePasses.forEach((manifestPass, index) => {
      const graphPass = definition.passes[index];
      expect(graphPass.reads).toEqual(manifestPass.reads);
      expect(graphPass.writes).toEqual(manifestPass.writes);
    });
  });

  it("keeps every inspector attachment bound to a manifest resource and its real last writer", () => {
    const resources = new Map(referenceFrameResources.map((resource) => [resource.id, resource]));
    referenceFrameAttachments.forEach((attachment) => {
      const info = attachmentInfo(attachment.view as ReferenceView);
      const resource = resources.get(attachment.resource);
      expect(resource).toBeDefined();
      expect(info).toMatchObject({
        label: attachment.label,
        format: attachment.format,
        range: attachment.range,
        lastWriter: attachment.lastWriter,
      });
      expect(resource?.lastWriter).toBe(attachment.lastWriter);
    });
  });

  it("compiles the manifest graph and keeps the only culled node explicitly synthetic", () => {
    const allEnabled = new Set(renderGraphPasses.map((pass) => pass.id));
    const result = compileRenderGraph(createRenderGraphDefinition(allEnabled));
    expect(result.diagnostics).toEqual([]);
    expect(result.plan?.passes.map((pass) => pass.id)).toEqual(
      referenceFramePasses.map((pass) => pass.id),
    );
    expect(result.plan?.culledPassIds).toEqual(["diagnostic-debug-overlay"]);
    expect(result.plan?.passes.find((pass) => pass.id === "cluster-light-count")?.writes).toEqual([
      {
        resource: "cluster-light-count",
        usage: "render-attachment",
        version: 1,
        versionId: "cluster-light-count@1",
      },
    ]);
  });
});
