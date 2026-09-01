import { expect, test } from "@playwright/test";

test("Material & Lighting retains its node-renderer controls on the WebGPU/WebGL2 path", async ({
  page,
}) => {
  await page.goto("demos/material-lighting/");
  const shell = page.locator("[data-demo-shell]");
  const controls = shell.locator("[data-demo-controls]");

  await shell.scrollIntoViewIfNeeded();
  await expect(shell).toHaveAttribute("data-demo-state", "running", { timeout: 20_000 });
  await expect(controls.getByLabel("Base Color", { exact: true })).toBeVisible();
  await expect(controls.getByLabel("Metalness", { exact: true })).toBeVisible();
  await expect(controls.getByLabel("Roughness", { exact: true })).toBeVisible();
  await expect(controls.getByLabel("Clearcoat", { exact: true })).toBeVisible();
  await expect(controls.getByLabel("Clearcoat Roughness", { exact: true })).toBeVisible();
  await expect(controls.getByLabel("Exposure", { exact: true })).toBeVisible();
  for (const preset of ["DIELECTRIC", "METAL", "ROUGH", "CLEARCOAT"])
    await expect(controls.getByRole("button", { name: preset, exact: true })).toBeVisible();
  await expect(
    controls.getByRole("button", { name: "DIRECT ISOLATION", exact: true }),
  ).toBeVisible();
  await expect(controls.getByRole("button", { name: "IBL ISOLATION", exact: true })).toBeVisible();

  await controls.getByRole("button", { name: "METAL", exact: true }).click();
  await expect(controls.getByLabel("Metalness", { exact: true })).toHaveValue("1");
  await expect(controls.getByLabel("Clearcoat", { exact: true })).toHaveValue("0");

  await controls.getByRole("button", { name: "DIRECT ISOLATION", exact: true }).click();
  await expect(shell.locator("[data-demo-status]")).toContainText(
    "PMREM environment contribution is disabled",
  );
});

test("home hero keeps its 21:9 calibration frame static for reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("");
  const poster = page.locator(".hero-demo-poster");
  const calibration = page.locator(".hero-calibration-line span");

  expect(await poster.evaluate((element) => getComputedStyle(element).aspectRatio)).toContain("21");
  await expect(calibration).toHaveCSS("animation-name", "none");
});
