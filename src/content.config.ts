import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const locale = z.enum(["zh-CN", "en"]);
const contentStatus = z.enum(["idea", "in-progress", "completed", "archived"]);
const commonFields = {
  locale,
  translationKey: z.string().min(1),
  draft: z.boolean().default(false),
  publishedAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(),
};

const projects = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/projects" }),
  schema: z
    .object({
      ...commonFields,
      routeSlug: z.string().min(1),
      title: z.string().min(1),
      summary: z.string().min(1),
      status: contentStatus,
      year: z.number().int().min(2000),
      role: z.string().min(1),
      platforms: z.array(z.string()).min(1),
      technologies: z.array(z.string()).min(1),
      heroImage: z.string().min(1),
      previewVideo: z.string().optional(),
      responsibilities: z.array(z.string()).default([]),
      featureSlugs: z.array(z.string()).default([]),
      demoSlugs: z.array(z.string()).default([]),
      articleSlugs: z.array(z.string()).default([]),
      metrics: z
        .array(
          z.object({
            label: z.string().min(1),
            value: z.string().min(1),
            status: z.enum(["confirmed", "draft"]).default("draft"),
          }),
        )
        .default([]),
      sourceUrl: z.url().optional(),
    })
    .loose(),
});

const demos = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/demos" }),
  schema: z
    .object({
      ...commonFields,
      routeSlug: z.string().min(1),
      title: z.string().min(1),
      summary: z.string().min(1),
      status: contentStatus,
      category: z.enum(["rendering", "engine", "gpu", "simulation", "tools", "machine-learning"]),
      backend: z.enum([
        "three-webgpu",
        "three-webgl",
        "raw-webgpu",
        "svg",
        "onnx-web",
        "canvas-2d",
      ]),
      capabilities: z.array(z.enum(["webgpu", "webgl2", "wasm"])).default([]),
      featured: z.boolean().default(false),
      fallbackImage: z.string().min(1),
      fallbackVideo: z.string().optional(),
      controls: z.array(z.string()).default([]),
      relatedProjects: z.array(z.string()).min(1),
      relatedArticles: z.array(z.string()).default([]),
      sourceUrl: z.url().optional(),
    })
    .loose(),
});

const writing = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/writing" }),
  schema: z
    .object({
      ...commonFields,
      routeSlug: z.string().min(1),
      title: z.string().min(1),
      description: z.string().min(1),
      category: z.enum([
        "rendering",
        "engine-architecture",
        "gpu-performance",
        "multimedia",
        "deep-learning",
      ]),
      tags: z.array(z.string()).min(1),
      readingMinutes: z.number().int().positive(),
      relatedProject: z.string().optional(),
      relatedDemo: z.string().optional(),
      englishTitle: z.string().min(1),
      englishDescription: z.string().min(1),
    })
    .loose(),
});

const experience = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/experience" }),
  schema: z
    .object({
      ...commonFields,
      title: z.string().min(1),
      industry: z.string().min(1),
      startYear: z.number().int().min(2000),
      endYear: z.number().int().min(2000).optional(),
      summary: z.string().min(1),
      responsibilities: z.array(z.string()).min(1),
      results: z
        .array(
          z.object({
            statement: z.string().min(1),
            status: z.enum(["confirmed", "draft"]).default("draft"),
          }),
        )
        .default([]),
    })
    .loose(),
});

export const collections = { projects, demos, writing, experience };
