import { writeFile } from "node:fs/promises";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";
import { resolveSiteFeatures } from "./src/data/site-stage.mjs";

const configuredSite = process.env.SITE_URL ?? "https://example.invalid";
const githubPagesBase = "/graphics-portfolio";
const features = resolveSiteFeatures(process.env.SITE_STAGE);
const robotsBody = features.indexing
  ? `User-agent: *\nAllow: /\nSitemap: ${new URL(`${githubPagesBase}/sitemap-index.xml`, configuredSite)}\n`
  : "User-agent: *\nDisallow: /\n";

const stageRobots = {
  name: "stage-robots",
  hooks: {
    "astro:build:generated": async ({ dir }) => {
      await writeFile(new URL("robots.txt", dir), robotsBody, "utf8");
    },
  },
};

export default defineConfig({
  site: configuredSite,
  base: githubPagesBase,
  output: "static",
  trailingSlash: "always",
  integrations: [mdx(), stageRobots, ...(features.sitemap ? [sitemap()] : [])],
  vite: {
    build: {
      target: "es2022",
      // The WebGPU renderer component is click/viewport-lazy. Its entry chunk
      // has a 220 kB gzip budget and its complete transitive Three runtime has
      // a separate 320 kB budget enforced by tests/performance-budget.mjs.
      chunkSizeWarningLimit: 700,
    },
  },
});
