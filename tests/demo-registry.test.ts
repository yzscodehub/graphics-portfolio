import { describe, expect, it } from "vitest";
import { demoRegistry } from "../src/demos/core/registry";

describe("demo registry", () => {
  it("publishes the seven planned technical demos", () => {
    expect(Object.keys(demoRegistry).sort()).toEqual([
      "frame-inspector",
      "gpu-particles",
      "material-lighting",
      "neural-denoising",
      "path-tracer",
      "render-graph",
      "shadow-aa",
    ]);
  });

  it("maps every demo to at least one project", () => {
    Object.values(demoRegistry).forEach(({ definition }) => {
      expect(definition.relatedProjects.length).toBeGreaterThan(0);
    });
  });
});
