/**
 * Public identity data for the portfolio.
 *
 * This preview identity intentionally exposes only a developer handle and
 * GitHub profile. Contact data is added only for the later release stage.
 */

export type Locale = "zh-CN" | "en";

export interface LocalizedText {
  "zh-CN": string;
  en: string;
}

export interface PublicProfile {
  displayName: string;
  publicEmail: string | null;
  githubUsername: string;
  githubUrl: string;
  role: LocalizedText;
  headline: LocalizedText;
  bio: LocalizedText;
  focus: readonly string[];
  availability: LocalizedText;
  releaseGuard: {
    enabled: boolean;
    ready: boolean;
    requiredReplacements: readonly string[];
    policy: string;
  };
}

export const profile = {
  displayName: "yzscodehub",
  publicEmail: null,
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
    requiredReplacements: ["publicEmail"],
    policy:
      "Preview intentionally has no public email. Add an intentionally public address only for a release build; never add a phone number, salary, address, or private employer material.",
  },
} as const satisfies PublicProfile;

export type Profile = typeof profile;
