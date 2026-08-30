import { expect, test } from "@playwright/test";

const routes = [
  ["", "zh"],
  ["work/", "zh"],
  ["demos/", "zh"],
  ["writing/", "zh"],
  ["lab/", "zh"],
  ["about/", "zh"],
  ["resume/", "zh"],
  ["en/", "en"],
  ["en/work/", "en"],
  ["en/demos/", "en"],
  ["en/writing/", "en"],
  ["en/lab/", "en"],
  ["en/about/", "en"],
  ["en/resume/", "en"],
] as const;

for (const [route, expectedLanguage] of routes) {
  test(`${route || "home"} responds with the declared language`, async ({ page }) => {
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("lang", new RegExp(`^${expectedLanguage}`));
    await expect(page.locator("main")).toBeVisible();
  });
}

test("mobile layouts do not introduce horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});
