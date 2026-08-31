import { describe, expect, it } from "vitest";
import {
  getWritingModule,
  writingModuleIds,
  writingModulePath,
  writingModules,
} from "../src/data/writing-modules";
import { deriveReadingMinutes, resolveReadingTime } from "../src/content/reading-time";

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

describe("writing reading-time contract", () => {
  it("derives time from CJK prose, Latin words, and fenced code", () => {
    expect(deriveReadingMinutes("图".repeat(600))).toBe(2);
    expect(deriveReadingMinutes(Array.from({ length: 180 }, () => "word").join(" "))).toBe(1);
    expect(
      deriveReadingMinutes(
        `\`\`\`wgsl\n${Array.from({ length: 13 }, (_, index) => `line${index}`).join("\n")}\n\`\`\``,
      ),
    ).toBe(2);
  });

  it("uses an explicitly reasoned editorial override only when supplied", () => {
    expect(resolveReadingTime({ body: "图".repeat(300), data: {} })).toEqual({
      minutes: 1,
      source: "derived",
    });
    expect(
      resolveReadingTime({
        body: "short",
        data: {
          readingMinutesOverride: 6,
          readingMinutesOverrideReason: "Interactive exercise includes a timed device run.",
        },
      }),
    ).toEqual({
      minutes: 6,
      source: "editorial-override",
      overrideReason: "Interactive exercise includes a timed device run.",
    });
  });
});
