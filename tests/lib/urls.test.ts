import { describe, expect, it } from "vitest";
import { defaultLocale, isLocale, otherLocale } from "../../src/lib/i18n";
import { localePath, otherLocalePath, siteBase, withBase, withSourceRef } from "../../src/lib/urls";

describe("i18n helpers", () => {
  it("uses Chinese as the default locale", () => {
    expect(defaultLocale).toBe("zh-CN");
    expect(isLocale("zh-CN")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(otherLocale["zh-CN"]).toBe("en");
  });
});

describe("route helpers", () => {
  it("adds and removes the English prefix without adding the project base", () => {
    expect(localePath("/work/", "zh-CN")).toBe("/work/");
    expect(localePath("/work", "en")).toBe("/en/work/");
    expect(localePath("/en/demos/", "zh-CN")).toBe("/demos/");
    expect(localePath("/graphics-portfolio/en/demos/", "zh-CN")).toBe("/demos/");
    expect(localePath("/", "en")).toBe("/en/");
  });

  it("preserves query strings and anchors while switching locale", () => {
    expect(localePath("/writing/?tag=webgpu#latest", "en")).toBe("/en/writing/?tag=webgpu#latest");
    expect(otherLocalePath("/en/work/", "en")).toBe("/work/");
    expect(otherLocalePath("/work/", "zh-CN")).toBe("/en/work/");
  });

  it("adds the GitHub Pages base exactly once", () => {
    expect(siteBase).toBe("/graphics-portfolio/");
    expect(withBase("/work/")).toBe("/graphics-portfolio/work/");
    expect(withBase("/graphics-portfolio/work/")).toBe("/graphics-portfolio/work/");
    expect(withBase("/graphics-portfolio")).toBe("/graphics-portfolio");
    expect(withBase(localePath("/demos/", "en"))).toBe("/graphics-portfolio/en/demos/");
  });

  it("does not rewrite external links or in-page anchors", () => {
    expect(withBase("https://github.com/example")).toBe("https://github.com/example");
    expect(withBase("mailto:contact@example.com")).toBe("mailto:contact@example.com");
    expect(withBase("#contact")).toBe("#contact");
  });

  it("binds public source links to the reviewed build ref", () => {
    const source =
      "https://github.com/yzscodehub/graphics-portfolio/blob/main/src/demos/clustered-lighting.ts";
    expect(withSourceRef(source, "feature/rendering-demo-v2")).toBe(
      "https://github.com/yzscodehub/graphics-portfolio/blob/feature/rendering-demo-v2/src/demos/clustered-lighting.ts",
    );
    expect(withSourceRef(source, "v1.0.0")).toContain("/blob/v1.0.0/");
    expect(() => withSourceRef(source, "../main")).toThrow(/Unsafe Git source ref/);
  });
});
