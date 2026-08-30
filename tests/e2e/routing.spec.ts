import { expect, test } from "@playwright/test";

const isPreview = process.env.SITE_STAGE !== "release";
const routes = [
  ["", "zh"],
  ["work/", "zh"],
  ["demos/", "zh"],
  ["writing/", "zh"],
  ["lab/", "zh"],
  ["about/", "zh"],
  ["en/", "en"],
  ["en/work/", "en"],
  ["en/demos/", "en"],
  ["en/writing/", "en"],
  ["en/lab/", "en"],
  ["en/about/", "en"],
] as const;

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
    }
  });
}

test("deferred resume routes return 404", async ({ page }) => {
  test.skip(!isPreview, "Resume routes are exercised by the formal release suite.");
  for (const route of ["resume/", "en/resume/"]) {
    const response = await page.goto(route);
    expect(response?.status()).toBe(404);
  }
});

test("contact controls are GitHub-only during public preview", async ({ page }) => {
  test.skip(!isPreview, "Release contact options are validated separately.");
  await page.goto("");
  const contactLinks = page.locator("[data-contact-link]");
  await expect(contactLinks).toHaveCount(1);
  await expect(contactLinks).toHaveAttribute("href", "https://github.com/yzscodehub");
});

test("mobile layouts do not introduce horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});

test("mobile capability uses a static Demo fallback", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.addInitScript(() => {
    window.matchMedia = (query: string) =>
      ({
        matches: query === "(pointer: coarse)",
        media: query,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent() {
          return false;
        },
      }) as MediaQueryList;
  });
  await page.goto("demos/gpu-particles/");
  await expect(page.locator("[data-demo-shell]")).toHaveAttribute("data-demo-state", "fallback");
  await expect(page.locator("[data-demo-fallback]")).toBeVisible();
});
