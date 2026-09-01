import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { writingModuleIds } from "./data/writing-modules";

const locale = z.enum(["zh-CN", "en"]);
const contentStatus = z.enum(["idea", "in-progress", "completed", "archived"]);
const demoBackend = z.enum([
  "three-webgpu",
  "three-webgl",
  "raw-webgpu",
  "svg",
  "onnx-web",
  "canvas-2d",
]);
const demoCapability = z.enum(["webgpu", "webgl2", "wasm"]);
const demoRequirement = z.union([
  z.string().min(1),
  z.object({
    label: z.string().min(1),
    required: z.boolean().default(true),
    capability: demoCapability.optional(),
  }),
]);
const demoBackendRecord = z.object({
  id: demoBackend,
  label: z.string().min(1),
  role: z.enum(["primary", "fallback"]),
  capabilities: z.array(demoCapability).default([]),
});
const demoFallback = z.object({
  kind: z.enum(["canvas-2d", "static-image", "none"]),
  description: z.string().min(1),
  image: z.string().min(1).optional(),
});
const demoMetricSource = z.object({
  kind: z.enum(["runtime", "offline-validation", "not-applicable"]),
  description: z.string().min(1),
});
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
      architectureImage: z.string().min(1),
      architectureAlt: z.string().min(1),
      demoImage: z.string().min(1),
      demoImageAlt: z.string().min(1),
      environment: z.array(z.string().min(1)).min(3),
      reproduction: z.string().min(1),
      architecture: z.string().min(1),
      limitations: z.array(z.string().min(1)).min(1),
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
      /** Legacy card label. New presentation should prefer `maturity`. */
      status: contentStatus,
      category: z.enum(["rendering", "engine", "gpu", "simulation", "tools", "machine-learning"]),
      /** Legacy primary backend fields retained for existing MDX and routes. */
      renderer: z.string().min(1).optional(),
      backend: demoBackend,
      capabilities: z.array(demoCapability).default([]),
      /** Preview may expose an honest in-progress study; Release requires completed. */
      maturity: z.enum(["in-progress", "completed"]).optional(),
      /** `verified` means behavior is covered; `measured` has a stated measurement source. */
      evidence: z.enum(["verified", "measured"]).optional(),
      /** Structured replacement for the legacy primary `backend` field. */
      backends: z.array(demoBackendRecord).optional(),
      featured: z.boolean().default(false),
      fallbackImage: z.string().min(1),
      fallbackVideo: z.string().optional(),
      /** Accept legacy string requirements while allowing structured declarations. */
      requirements: z.array(demoRequirement).default([]),
      fallback: demoFallback.optional(),
      controls: z.array(z.string()).default([]),
      metrics: z
        .array(
          z.object({
            label: z.string().min(1),
            value: z.string().min(1),
            status: z.enum(["confirmed", "draft", "verified", "measured"]).default("draft"),
            source: z.string().min(1).optional(),
          }),
        )
        .default([]),
      /** Accept the existing prose field and normalize it to a structured source. */
      metricSource: z.union([z.string().min(1), demoMetricSource]).optional(),
      /** One concise, locale-specific statement of the implementation boundary. */
      currentLimit: z.string().min(12),
      relatedProjects: z.array(z.string()).min(1),
      relatedArticles: z.array(z.string()).default([]),
      assetIds: z.array(z.string().min(1)).default([]),
      modes: z.array(z.string().min(1)).default([]),
      referenceScene: z
        .enum([
          "calibration-rig",
          "research-courtyard",
          "reference-frame-procedural",
          "visibility-instance-field",
          "cornell",
        ])
        .optional(),
      sourceUrl: z.url().optional(),
    })
    .loose()
    .transform((entry) => {
      const hasMeasuredEvidence = entry.metrics.length > 0 || entry.metricSource !== undefined;
      const metricSource =
        typeof entry.metricSource === "string"
          ? {
              kind: hasMeasuredEvidence ? "offline-validation" : "not-applicable",
              description: entry.metricSource,
            }
          : (entry.metricSource ?? {
              kind: "not-applicable",
              description: "No numeric claim is published for this completed interactive study.",
            });

      return {
        ...entry,
        maturity: entry.maturity ?? (entry.status === "completed" ? "completed" : "in-progress"),
        evidence: entry.evidence ?? (hasMeasuredEvidence ? "measured" : "verified"),
        backends:
          entry.backends && entry.backends.length > 0
            ? entry.backends
            : [
                {
                  id: entry.backend,
                  label: entry.renderer ?? entry.backend,
                  role: "primary",
                  capabilities: entry.capabilities,
                },
              ],
        fallback: entry.fallback ?? {
          kind: "static-image",
          description:
            "A local static preview is shown when the interactive renderer is unavailable.",
          image: entry.fallbackImage,
        },
        metricSource,
      };
    }),
});

const writing = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/writing" }),
  schema: z
    .object({
      ...commonFields,
      routeSlug: z.string().min(1),
      title: z.string().min(1),
      description: z.string().min(1),
      module: z.enum(writingModuleIds),
      moduleOrder: z.number().int().positive(),
      articleOrder: z.number().int().positive(),
      level: z.enum(["foundation", "intermediate", "advanced"]),
      prerequisites: z.array(z.string().min(1)).min(2),
      learningOutcomes: z.array(z.string().min(1)).min(3),
      relatedArticles: z.array(z.string().min(1)),
      relatedProjects: z.array(z.string().min(1)),
      relatedDemos: z.array(z.string().min(1)),
      tags: z.array(z.string()).min(1),
      readingMinutesOverride: z.number().int().positive().optional(),
      readingMinutesOverrideReason: z.string().min(12).optional(),
      englishTitle: z.string().min(1),
      englishDescription: z.string().min(1),
      publishedAt: z.coerce.date(),
      updatedAt: z.coerce.date(),
    })
    .strict()
    .superRefine((entry, context) => {
      const hasMinutes = entry.readingMinutesOverride !== undefined;
      const hasReason = entry.readingMinutesOverrideReason !== undefined;
      if (hasMinutes !== hasReason)
        context.addIssue({
          code: "custom",
          message:
            "readingMinutesOverride and readingMinutesOverrideReason must be provided together.",
          path: hasMinutes ? ["readingMinutesOverrideReason"] : ["readingMinutesOverride"],
        });
    }),
});

const experience = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/experience" }),
  schema: z
    .object({
      locale,
      translationKey: z.string().min(1),
      draft: z.boolean().default(false),
      title: z.string().min(1),
      industry: z.string().min(1),
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
    .strict(),
});

export const collections = { projects, demos, writing, experience };
