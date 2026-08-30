/**
 * Public identity data for the portfolio.
 *
 * The three placeholder values are intentional. They are consumed by the
 * release guard in the production build and must be replaced before a public
 * deployment. Keeping them here avoids leaking private contact information
 * into content, metadata, or generated resume files.
 */

export type Locale = "zh-CN" | "en";

export interface LocalizedText {
  "zh-CN": string;
  en: string;
}

export const profile = {
  displayName: "yzscodehub",
  publicEmail: "PUBLIC_EMAIL",
  githubUsername: "yzscodehub",
  githubUrl: "https://github.com/yzscodehub",
  role: {
    "zh-CN": "图形系统工程师",
    en: "Graphics Systems Engineer",
  },
  headline: {
    "zh-CN": "构建实时图形背后的系统。",
    en: "I build the systems behind real-time graphics.",
  },
  bio: {
    "zh-CN":
      "专注于实时渲染、引擎架构、GPU Compute 与多媒体系统；目前持续学习深度学习，并探索神经图形的工程化路径。",
    en: "Focused on real-time rendering, engine architecture, GPU compute, and multimedia systems; currently studying deep learning and exploring practical paths into neural graphics.",
  },
  focus: ["Rendering", "Engine Architecture", "GPU / Compute", "Multimedia", "Neural Graphics"],
  availability: {
    "zh-CN": "欢迎交流图形、引擎与智能图形方向的机会。",
    en: "Open to conversations about graphics, engine, and intelligent-graphics work.",
  },
  releaseGuard: {
    enabled: true,
    ready: false,
    requiredReplacements: ["displayName", "publicEmail", "githubUsername"],
    policy:
      "Replace every placeholder with an intentionally public value before production deployment. Do not add a phone number, salary, address, or private employer material to this object.",
  },
} as const;

export type Profile = typeof profile;
