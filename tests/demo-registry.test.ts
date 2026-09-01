import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { demoRegistry } from "../src/demos/core/registry";

const publicContractFields = [
  "maturity",
  "relatedProjects",
  "relatedArticles",
  "assetIds",
  "modes",
] as const;

function demoFrontmatter(slug: string, locale: "en" | "zh-CN"): Record<string, string | string[]> {
  const file = fileURLToPath(new URL(`../src/content/demos/${slug}.${locale}.md`, import.meta.url));
  const source = readFileSync(file, "utf8");
  const frontmatter = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatter) throw new Error(`${file} is missing frontmatter.`);
  const values: Record<string, string | string[]> = {};
  let activeList: string | undefined;
  for (const line of frontmatter[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (field) {
      activeList = field[2] === "" ? field[1] : undefined;
      values[field[1]] =
        field[2] === "" || field[2] === "[]" ? [] : field[2].replace(/^['"]|['"]$/g, "");
      continue;
    }
    const listItem = activeList ? line.match(/^\s{2}-\s+(.+)$/) : undefined;
    if (listItem && activeList) {
      const list = values[activeList];
      if (Array.isArray(list)) list.push(listItem[1]);
    }
  }
  return values;
}

describe("demo registry", () => {
  it("publishes the eight planned technical demos", () => {
    expect(Object.keys(demoRegistry).sort()).toEqual([
      "clustered-lighting",
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

  it("keeps GPU-dependent studies in progress until their hardware and evidence gates clear", () => {
    const maturity = Object.fromEntries(
      Object.entries(demoRegistry).map(([slug, entry]) => [slug, entry.definition.maturity]),
    );
    expect(maturity["render-graph"]).toBe("completed");
    expect(
      Object.entries(maturity)
        .filter(([slug]) => slug !== "render-graph")
        .every(([, value]) => value === "in-progress"),
    ).toBe(true);
  });

  it("binds every Demo to explicit modes, source, and auditable asset ids", () => {
    Object.values(demoRegistry).forEach(({ definition }) => {
      expect(definition.modes.length).toBeGreaterThan(0);
      expect(definition.sourceUrl).toMatch(
        /^https:\/\/github\.com\/yzscodehub\/graphics-portfolio\/blob\/main\//,
      );
      expect(definition.assetIds.every((assetId) => assetId.length > 0)).toBe(true);
    });
  });

  it("uses bilingual Demo content frontmatter as the single public contract source", () => {
    const registrySlugs = Object.keys(demoRegistry).sort();
    for (const slug of registrySlugs) {
      for (const locale of ["zh-CN", "en"] as const) {
        const content = demoFrontmatter(slug, locale);
        const definition = demoRegistry[slug].definition;
        expect(content.routeSlug).toBe(slug);
        for (const field of publicContractFields) expect(definition[field]).toEqual(content[field]);
        expect(definition.referenceScene).toBe(content.referenceScene || undefined);
        expect(definition.sourceUrl).toBe(content.sourceUrl);
      }
    }
  });
});
