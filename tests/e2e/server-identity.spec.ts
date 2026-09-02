import { expect, test } from "@playwright/test";

test("uses the E2E server launched for this run", async ({ request }) => {
  const baseUrl = requiredEnvironment("GRAPHICS_PORTFOLIO_E2E_BASE_URL");
  const token = requiredEnvironment("GRAPHICS_PORTFOLIO_E2E_RUN_TOKEN");
  const digest = requiredEnvironment("GRAPHICS_PORTFOLIO_E2E_BUILD_DIGEST");

  expect(token).toMatch(/^[a-f0-9]{64}$/i);
  expect(digest).toMatch(/^[a-f0-9]{64}$/i);

  const page = await request.get(baseUrl);
  expect(page.ok()).toBe(true);
  expect(page.headers()["x-graphics-portfolio-preview"]).toBe("1");
  expect(page.headers()["x-graphics-portfolio-run-token"]).toBe(token);
  expect(page.headers()["x-graphics-portfolio-build-digest"]).toBe(digest);

  const manifest = await request.get(new URL("build-manifest.json", baseUrl).href);
  expect(manifest.ok()).toBe(true);
  expect(manifest.headers()["x-graphics-portfolio-run-token"]).toBe(token);
  expect(manifest.headers()["x-graphics-portfolio-build-digest"]).toBe(digest);
  await expect(manifest.json()).resolves.toMatchObject({
    version: 1,
    dist: { sha256: digest },
    summary: {
      rendering: {
        assetStatus: "preview-placeholder",
        sourceLockStage: "sources-reviewed",
      },
      acceptance: { status: "pending", hasReviewedRun: false },
      neural: { version: 2, guidedStatus: "candidate" },
    },
  });
});

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`test:e2e must be started by scripts/run-e2e.mjs; missing ${name}.`);
  return value;
}
