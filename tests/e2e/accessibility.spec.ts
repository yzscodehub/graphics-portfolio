import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const routes = [
  "",
  "work/",
  "demos/",
  "writing/",
  "writing/modules/rendering/",
  "writing/bvh-progressive-path-tracing/",
  "writing/multimedia-data-path/",
  "lab/",
  "about/",
  "en/",
  "en/writing/",
  "demos/material-lighting/",
  "demos/render-graph/",
  "demos/frame-inspector/",
  "demos/neural-denoising/",
];

for (const route of routes) {
  test(`${route || "home"} has no serious automated accessibility violations`, async ({ page }) => {
    await page.goto(route);
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const blocking = result.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });
}

test("the open mobile navigation has no serious accessibility violations", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("");
  await page.locator("[data-nav-toggle]").click();
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blocking = result.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
});
