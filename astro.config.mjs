import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";

const configuredSite = process.env.SITE_URL ?? "https://example.invalid";
const githubPagesBase = "/graphics-portfolio";

export default defineConfig({
  site: configuredSite,
  base: githubPagesBase,
  output: "static",
  trailingSlash: "always",
  integrations: [mdx(), sitemap()],
  vite: {
    build: {
      target: "es2022",
    },
  },
});
