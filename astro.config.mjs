import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";

const configuredSite = process.env.SITE_URL ?? "https://example.invalid";
const githubPagesBase = "/graphics-portfolio";
const featureConfigPath = fileURLToPath(new URL("./src/data/site-features.json", import.meta.url));
const fallbackFeatures = {
  stage: "preview",
  resume: false,
  emailContact: false,
  indexing: false,
};
const configuredFeatures = existsSync(featureConfigPath)
  ? JSON.parse(readFileSync(featureConfigPath, "utf8"))
  : fallbackFeatures;
const stage = process.env.SITE_STAGE ?? configuredFeatures.stage;
const isReleaseBuild = stage === "release";

export default defineConfig({
  site: configuredSite,
  base: githubPagesBase,
  output: "static",
  trailingSlash: "always",
  integrations: [mdx(), ...(isReleaseBuild ? [sitemap()] : [])],
  vite: {
    build: {
      target: "es2022",
    },
  },
});
