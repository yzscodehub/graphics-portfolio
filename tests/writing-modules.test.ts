import { describe, expect, it } from "vitest";
import {
  getWritingModule,
  writingModuleIds,
  writingModulePath,
  writingModules,
} from "../src/data/writing-modules";

describe("writing module map", () => {
  it("keeps six graphics tracks followed by one adjacent multimedia track", () => {
    expect(writingModuleIds).toEqual([
      "rendering",
      "engine-systems",
      "gpu-compute",
      "ray-tracing",
      "debugging",
      "neural-graphics",
      "multimedia",
    ]);
    expect(writingModules.map((module) => module.order)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(writingModules.filter((module) => module.adjacent).map((module) => module.id)).toEqual([
      "multimedia",
    ]);
  });

  it("publishes complete bilingual copy and base-free routes", () => {
    for (const module of writingModules) {
      expect(module.title["zh-CN"].length).toBeGreaterThan(1);
      expect(module.title.en.length).toBeGreaterThan(1);
      expect(module.description["zh-CN"].length).toBeGreaterThan(10);
      expect(module.question.en.length).toBeGreaterThan(10);
      expect(getWritingModule(module.id)).toBe(module);
      expect(writingModulePath(module.id, "zh-CN")).toBe(`/writing/modules/${module.id}/`);
      expect(writingModulePath(module.id, "en")).toBe(`/en/writing/modules/${module.id}/`);
    }
  });
});
