import { expect, test } from "@playwright/test";

test("Writing is grouped into six graphics tracks and one adjacent systems track", async ({
  page,
}) => {
  await page.goto("writing/");
  await expect(page.locator(".writing-module-nav li")).toHaveCount(7);
  await expect(page.locator(".writing-module")).toHaveCount(7);
  await expect(page.locator(".article-card")).toHaveCount(10);

  const moduleHrefs = await page
    .locator(".writing-module-nav a")
    .evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).getAttribute("href")));
  expect(moduleHrefs).toEqual([
    "#module-rendering",
    "#module-engine-systems",
    "#module-gpu-compute",
    "#module-ray-tracing",
    "#module-debugging",
    "#module-neural-graphics",
    "#module-multimedia",
  ]);
});

test("English Writing cards identify Chinese full text without implying a translation", async ({
  page,
}) => {
  await page.goto("en/writing/");
  await expect(page.locator(".writing-language-note")).toContainText(
    "ENGLISH ABSTRACT / CHINESE FULL TEXT",
  );
  await expect(page.locator(".article-card")).toHaveCount(10);
  await expect(page.locator(".article-card .card-link").first()).toHaveAttribute(
    "aria-label",
    /^READ CHINESE:/,
  );
});

test("article context exposes module sequence, evidence links, and an H2 table of contents", async ({
  page,
}) => {
  await page.goto("writing/bvh-progressive-path-tracing/");
  const context = page.locator(".writing-article-context");
  await expect(context).toBeVisible();
  expect(await context.locator(".writing-toc a").count()).toBeGreaterThanOrEqual(7);
  await expect(context.locator(".writing-related-list a")).not.toHaveCount(0);
  await expect(page.locator(".locale-link")).toHaveText("EN ABSTRACTS");
  expect(await page.locator(".article-paper .prose > h2").count()).toBeGreaterThanOrEqual(7);
});

test("module landing pages keep bilingual alternates and responsive layout", async ({ page }) => {
  for (const route of ["writing/modules/rendering/", "en/writing/modules/rendering/"]) {
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    await expect(page.locator(".writing-module-landing-content .article-card")).toHaveCount(2);
    await expect(page.locator('link[rel="alternate"][hreflang]')).toHaveCount(2);
  }

  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("writing/");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    ).toBe(false);
  }
});

test("projects and Demos expose their module articles in both languages", async ({ page }) => {
  await page.goto("demos/path-tracer/");
  await expect(page.locator("[data-related-writing] .article-card")).toHaveCount(3);
  await expect(
    page.locator('[data-related-writing] a[href$="/writing/bvh-progressive-path-tracing/"]'),
  ).toBeVisible();

  await page.goto("en/demos/path-tracer/");
  await expect(page.locator("[data-related-writing] .article-card")).toHaveCount(3);
  await expect(page.locator("[data-related-writing] .card-link").first()).toHaveAttribute(
    "aria-label",
    /^READ CHINESE:/,
  );
});
