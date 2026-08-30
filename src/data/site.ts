import type { Locale, LocalizedText } from "./profile";
import { resolveSiteFeatures } from "./site-stage.mjs";

export { resolveSiteFeatures } from "./site-stage.mjs";
export type SiteFeatures = ReturnType<typeof resolveSiteFeatures>;

/**
 * The single source of truth for preview versus public-release behavior.
 * UI, static metadata, validation, and deployment consume this same object.
 */
export const features = resolveSiteFeatures();

export const site = {
  name: "Graphics Workbench",
  repository: "graphics-portfolio",
  basePath: "/graphics-portfolio/",
  defaultLocale: "zh-CN" as Locale,
  locales: ["zh-CN", "en"] as const,
  title: {
    "zh-CN": "图形系统工程师作品集",
    en: "Graphics Systems Engineer Portfolio",
  } satisfies LocalizedText,
  description: {
    "zh-CN": "实时渲染、引擎架构、GPU Compute、多媒体与神经图形实验。",
    en: "Real-time rendering, engine architecture, GPU compute, multimedia, and neural-graphics experiments.",
  } satisfies LocalizedText,
  navigation: [
    {
      href: "/work/",
      label: { "zh-CN": "项目", en: "Work" } satisfies LocalizedText,
    },
    {
      href: "/demos/",
      label: { "zh-CN": "演示", en: "Demos" } satisfies LocalizedText,
    },
    {
      href: "/writing/",
      label: { "zh-CN": "文章", en: "Writing" } satisfies LocalizedText,
    },
    {
      href: "/lab/",
      label: { "zh-CN": "实验室", en: "Lab" } satisfies LocalizedText,
    },
    {
      href: "/about/",
      label: { "zh-CN": "关于", en: "About" } satisfies LocalizedText,
    },
  ],
  socialLinks: ["github"] as const,
  features,
} as const;

export type Site = typeof site;
