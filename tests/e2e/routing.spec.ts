import { readdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const isPreview = process.env.SITE_STAGE !== "release";
const expectedSourceRef =
  process.env.SOURCE_REF ?? (isPreview ? "feature/rendering-demo-v2" : "main");
const routes = [
  ["", "zh"],
  ["work/", "zh"],
  ["demos/", "zh"],
  ["demos/clustered-lighting/", "zh"],
  ["writing/", "zh"],
  ["writing/modules/rendering/", "zh"],
  ["lab/", "zh"],
  ["about/", "zh"],
  ["en/", "en"],
  ["en/work/", "en"],
  ["en/demos/", "en"],
  ["en/demos/clustered-lighting/", "en"],
  ["en/writing/", "en"],
  ["en/writing/modules/rendering/", "en"],
  ["en/lab/", "en"],
  ["en/about/", "en"],
  ["credits/", "zh"],
  ["en/credits/", "en"],
] as const;

function generatedRoutes(directory = path.resolve("dist"), prefix = ""): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = `${prefix}${entry.name}`;
    if (entry.isDirectory())
      return generatedRoutes(path.join(directory, entry.name), `${relative}/`);
    if (!entry.isFile() || !relative.endsWith(".html") || relative === "404.html") return [];
    if (relative === "index.html") return [""];
    return [relative.endsWith("/index.html") ? relative.slice(0, -"index.html".length) : relative];
  });
}

for (const [route, expectedLanguage] of routes) {
  test(`${route || "home"} responds with the declared language`, async ({ page }) => {
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("lang", new RegExp(`^${expectedLanguage}`));
    await expect(page.locator("main")).toBeVisible();
    if (isPreview) {
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
        "content",
        "noindex,nofollow",
      );
    } else {
      await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        "href",
        /^https:\/\/yzscodehub\.github\.io\/graphics-portfolio\//,
      );
      await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
        "content",
        /^https:\/\/yzscodehub\.github\.io\/graphics-portfolio\/og\//,
      );
    }
  });
}

test("every generated content route responds successfully", async ({ page }) => {
  test.setTimeout(90_000);
  const generated = generatedRoutes().sort();
  expect(generated).toHaveLength(64);

  for (const route of generated) {
    const response = await page.goto(route);
    expect(response?.status(), route || "home").toBe(200);
    await expect(page.locator("html"), route || "home").toHaveAttribute(
      "lang",
      route.startsWith("en/") ? /^en/ : /^zh/,
    );
    await expect(page.locator("main"), route || "home").toBeVisible();
  }
});

test("deferred resume routes return 404", async ({ page }) => {
  for (const route of ["resume/", "en/resume/"]) {
    const response = await page.goto(route);
    expect(response?.status()).toBe(404);
  }
});

test("the shared 404 offers both language entry points", async ({ page }) => {
  const response = await page.goto("en/not-found/");
  expect(response?.status()).toBe(404);
  await expect(page.getByText("Resource not bound.")).toBeVisible();
  await expect(page.getByRole("link", { name: "English home" })).toHaveAttribute(
    "href",
    "/graphics-portfolio/en/",
  );
  const alternate = await page.locator('link[rel="alternate"][hreflang="en"]').getAttribute("href");
  expect(new URL(alternate!).pathname).toBe("/graphics-portfolio/en/");
});

test("contact controls remain GitHub-only", async ({ page }) => {
  await page.goto("");
  const contactLinks = page.locator("[data-contact-link]");
  await expect(contactLinks).toHaveCount(1);
  await expect(contactLinks).toHaveAttribute("href", "https://github.com/yzscodehub");
  if (!isPreview) await expect(page.locator(".preview-status")).toHaveCount(0);
});

test("project case studies expose architecture, runtime, environment, and reproduction evidence", async ({
  page,
}) => {
  for (const slug of [
    "engine-systems-explorer",
    "real-time-rendering-lab",
    "webgpu-compute-lab",
    "neural-graphics-lab",
  ]) {
    await page.goto(`work/${slug}/`);
    const evidence = page.locator(".project-evidence");
    const evidenceImages = evidence.locator("figure img");
    await expect(evidenceImages).toHaveCount(2);
    await evidence.scrollIntoViewIfNeeded();
    await expect
      .poll(async () =>
        evidenceImages.evaluateAll(async (images) => {
          await Promise.all(
            images.map((image) => (image as HTMLImageElement).decode().catch(() => undefined)),
          );
          return images.every((image) => (image as HTMLImageElement).naturalWidth > 0);
        }),
      )
      .toBe(true);
    await expect(evidence.getByRole("heading", { name: "个人贡献" })).toBeVisible();
    await expect(evidence.getByRole("heading", { name: "测试环境" })).toBeVisible();
    await expect(evidence.getByRole("heading", { name: "复现方法" })).toBeVisible();
    await expect(evidence.getByRole("heading", { name: "当前边界" })).toBeVisible();
    await expect(page.locator("[data-related-writing] .article-card").first()).toBeVisible();
  }
});

test("mobile layouts do not introduce horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});

test("interactive Demo keeps a stable stage and hides its fallback", async ({ page }) => {
  await page.goto("demos/render-graph/");
  const shell = page.locator("[data-demo-shell]");
  const stage = shell.locator("[data-demo-stage]");
  await expect(shell).toHaveAttribute("data-demo-state", "running");
  await expect(shell.locator("[data-demo-state]")).toHaveText("运行中");
  await expect(shell.locator("[data-demo-state]")).toHaveAttribute("aria-live", "polite");
  await expect(shell.locator("[data-demo-fallback]")).toHaveCSS("display", "none");
  await expect(shell.locator('svg[aria-label^="Render graph execution plan"]')).toBeVisible();
  await expect(shell.locator("canvas")).toBeHidden();

  const heights = await stage.evaluate(async (element) => {
    const first = element.getBoundingClientRect().height;
    await new Promise((resolve) => window.setTimeout(resolve, 700));
    return { first, second: element.getBoundingClientRect().height };
  });
  expect(heights.second).toBeCloseTo(heights.first, 0);
});

test("standalone mode keeps only the focused Demo runtime surface", async ({ page }) => {
  await page.goto("demos/render-graph/?standalone=1#demo-runtime");
  await expect(page.locator("html")).toHaveClass(/demo-standalone/);
  await expect(page.locator(".site-header")).toBeHidden();
  await expect(page.locator(".page-hero")).toBeHidden();
  await expect(page.locator("[data-demo-detail-secondary]").first()).toBeHidden();
  await expect(page.locator("#demo-runtime")).toBeVisible();
});

test("Demo evidence separates the reference target, implementation limit, and fallback", async ({
  page,
}) => {
  await page.goto("demos/material-lighting/");
  const evidence = page.locator(".demo-evidence-panel");
  await expect(evidence.getByText("REFERENCE TARGET", { exact: true })).toBeVisible();
  await expect(evidence.getByText("MEASURED ON", { exact: true })).toHaveCount(0);
  await expect(
    evidence.locator("dt", { hasText: "CURRENT LIMIT" }).locator("..").locator("dd"),
  ).toContainText("GPU");
  await expect(evidence.locator("[data-demo-source-link]")).toHaveAttribute(
    "href",
    `https://github.com/yzscodehub/graphics-portfolio/blob/${expectedSourceRef}/src/demos/material-lighting.ts`,
  );

  await page.goto("demos/clustered-lighting/");
  await expect(
    page.locator(".demo-evidence-panel dt", { hasText: "ASSETS" }).locator("..").locator("dd"),
  ).toContainText("clustered-courtyard-proxy");
});

test("the legacy gpu-particles URL exposes the upgraded GPU-driven study", async ({ page }) => {
  const response = await page.goto("demos/gpu-particles/");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "GPU-Driven Visibility & Compute",
  );
  await expect(page.locator(".demo-evidence-panel")).toContainText("simulation / visibility");
});

test("Frame Inspector keeps one visible output surface on a narrow desktop", async ({ page }) => {
  await page.setViewportSize({ width: 500, height: 800 });
  await page.goto("demos/frame-inspector/");
  const shell = page.locator("[data-demo-shell]");

  await shell.scrollIntoViewIfNeeded();
  await expect(shell).toHaveAttribute("data-demo-state", /^(?:running|fallback)$/);
  const runtimeState = await shell.getAttribute("data-demo-state");
  await expect(shell.locator("[data-demo-state]")).toHaveText(
    runtimeState === "running" ? "运行中" : "静态预览",
  );
  if (runtimeState === "fallback") {
    await expect(shell.locator("[data-demo-metrics]")).toContainText("Canvas fallback");
  }
  await expect(shell.locator("[data-demo-controls] button")).toHaveCount(13);
  await expect(shell.locator("canvas:visible")).toHaveCount(1);
  await expect(shell.locator("[data-demo-fallback]")).toHaveCSS("display", "none");
});

async function mockStaticFallback(page: Page, query: string) {
  await page.addInitScript((activeQuery) => {
    window.matchMedia = (media: string) =>
      ({
        matches: media === activeQuery,
        media,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent() {
          return false;
        },
      }) as MediaQueryList;
  }, query);
}

for (const [name, query] of [
  ["coarse pointer", "(pointer: coarse)"],
  ["reduced motion", "(prefers-reduced-motion: reduce)"],
] as const) {
  test(`${name} uses a static Demo fallback without leaving the canvas in layout`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await mockStaticFallback(page, query);
    await page.goto("demos/gpu-particles/");
    const shell = page.locator("[data-demo-shell]");
    await expect(shell).toHaveAttribute("data-demo-state", "fallback");
    await expect(shell.locator("[data-demo-state]")).toHaveText("静态预览");
    await expect(shell.locator("[data-demo-state]")).toHaveAttribute("aria-live", "polite");
    await expect(shell.locator("canvas")).toHaveAttribute("hidden", "");
    await expect(shell.locator("canvas")).toHaveCSS("display", "none");
    await expect(shell.locator("[data-demo-fallback]")).toHaveCSS("display", "grid");
    await expect(shell.locator(".demo-shell__fallback-image")).toHaveAttribute(
      "src",
      "/graphics-portfolio/media/demos/gpu-particles-poster.svg",
    );
  });
}

test("mobile navigation focuses its first item, scrolls, and returns focus on Escape", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 180 });
  await page.goto("");
  const toggle = page.locator("[data-nav-toggle]");
  const nav = page.locator("[data-site-nav]");
  const firstItem = nav.locator("a").first();

  await toggle.click();
  await expect(nav).toHaveClass(/is-open/);
  await expect(firstItem).toBeFocused();
  expect(
    await nav.evaluate(
      (element) =>
        getComputedStyle(element).overflowY === "auto" &&
        element.scrollHeight > element.clientHeight,
    ),
  ).toBe(true);

  await page.keyboard.press("Escape");
  await expect(nav).not.toHaveClass(/is-open/);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeFocused();
});
