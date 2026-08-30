import { describe, expect, it } from "vitest";
import { compileRenderGraph, type RenderGraphDefinition } from "../src/demos/render-graph/core";

describe("RenderGraphCore", () => {
  it("culls unused work, computes lifetimes, aliases compatible transient resources, and plans usage transitions", () => {
    const result = compileRenderGraph(baseGraph());
    expect(result.diagnostics).toEqual([]);
    expect(result.plan?.passes.map((pass) => pass.id)).toEqual([
      "gbuffer",
      "lighting",
      "post",
      "present",
    ]);
    expect(result.plan?.culledPassIds).toEqual(["debug"]);

    const gbuffer = result.plan?.resourceVersions.find((resource) => resource.id === "gbuffer@1");
    const post = result.plan?.resourceVersions.find((resource) => resource.id === "post@1");
    expect(gbuffer).toMatchObject({ firstUse: 0, lastUse: 1 });
    expect(post).toMatchObject({ firstUse: 2, lastUse: 3 });
    expect(gbuffer?.aliasSlot).toBe(post?.aliasSlot);
    expect(result.plan?.usageTransitions).toContainEqual({
      from: "render-attachment",
      fromPass: "gbuffer",
      resourceVersion: "gbuffer@1",
      to: "sampled",
      toPass: "lighting",
    });
  });

  it("reports a dependency cycle created by an explicit future resource version", () => {
    const result = compileRenderGraph({
      resources: [
        { id: "frame", kind: "texture", format: "rgba8unorm", width: 1, height: 1 },
        {
          id: "present",
          kind: "texture",
          format: "bgra8unorm",
          width: 1,
          height: 1,
          external: true,
          present: true,
        },
      ],
      passes: [
        {
          id: "first",
          label: "First",
          reads: [{ resource: "frame", usage: "sampled", version: 2 }],
          writes: [{ resource: "frame", usage: "render-attachment" }],
        },
        {
          id: "second",
          label: "Second",
          reads: [{ resource: "frame", usage: "sampled", version: 1 }],
          writes: [
            { resource: "frame", usage: "render-attachment" },
            { resource: "present", usage: "present" },
          ],
          sideEffect: true,
        },
      ],
    });

    expect(result.plan).toBeUndefined();
    expect(result.diagnostics).toMatchObject([{ code: "cycle", severity: "error" }]);
  });

  it("rejects an enabled pass whose producer is disabled", () => {
    const graph = baseGraph();
    graph.passes.find((pass) => pass.id === "gbuffer")!.enabled = false;

    const result = compileRenderGraph(graph);

    expect(result.plan).toBeUndefined();
    expect(result.diagnostics).toMatchObject([{ code: "missing-producer", severity: "error" }]);
  });
});

function baseGraph(): RenderGraphDefinition {
  return {
    resources: [
      { id: "scene", kind: "buffer", format: "scene-data", size: 64, external: true },
      { id: "gbuffer", kind: "texture", format: "rgba16float", width: 16, height: 16 },
      { id: "lighting", kind: "texture", format: "rgba16float", width: 16, height: 16 },
      { id: "post", kind: "texture", format: "rgba16float", width: 16, height: 16 },
      {
        id: "present",
        kind: "texture",
        format: "bgra8unorm",
        width: 16,
        height: 16,
        external: true,
        present: true,
      },
    ],
    passes: [
      {
        id: "gbuffer",
        label: "GBuffer",
        reads: [{ resource: "scene", usage: "storage-read" }],
        writes: [{ resource: "gbuffer", usage: "render-attachment" }],
      },
      {
        id: "lighting",
        label: "Lighting",
        reads: [{ resource: "gbuffer", usage: "sampled" }],
        writes: [{ resource: "lighting", usage: "render-attachment" }],
      },
      {
        id: "post",
        label: "Post",
        reads: [{ resource: "lighting", usage: "sampled" }],
        writes: [{ resource: "post", usage: "render-attachment" }],
      },
      {
        id: "present",
        label: "Present",
        reads: [{ resource: "post", usage: "sampled" }],
        writes: [{ resource: "present", usage: "present" }],
        sideEffect: true,
      },
      {
        id: "debug",
        label: "Debug",
        reads: [{ resource: "scene", usage: "storage-read" }],
        writes: [{ resource: "lighting", usage: "storage-write" }],
      },
    ],
  };
}
