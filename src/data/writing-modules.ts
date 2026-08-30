import type { Locale } from "../lib/i18n";

export const writingModuleIds = [
  "rendering",
  "engine-systems",
  "gpu-compute",
  "ray-tracing",
  "debugging",
  "neural-graphics",
  "multimedia",
] as const;

export type WritingModuleId = (typeof writingModuleIds)[number];

type LocalizedCopy = Record<Locale, string>;

export interface WritingModule {
  id: WritingModuleId;
  order: number;
  code: string;
  adjacent?: boolean;
  title: LocalizedCopy;
  description: LocalizedCopy;
  question: LocalizedCopy;
}

export const writingModules: readonly WritingModule[] = [
  {
    id: "rendering",
    order: 1,
    code: "MOD_01",
    title: { "zh-CN": "实时渲染", en: "Real-time Rendering" },
    description: {
      "zh-CN": "从光照、材质到逐帧累积：让画质决策保留可解释的边界。",
      en: "Lighting, materials, and temporal accumulation with decisions kept inspectable.",
    },
    question: {
      "zh-CN": "怎样把一张好看的画面拆成可测量、可回退的渲染决策？",
      en: "How can a compelling frame become measurable, recoverable rendering decisions?",
    },
  },
  {
    id: "engine-systems",
    order: 2,
    code: "MOD_02",
    title: { "zh-CN": "引擎系统", en: "Engine Systems" },
    description: {
      "zh-CN": "RHI、Render Graph 与资源生命周期：把意图、差异和失败路径放在正确的边界。",
      en: "RHI, render graphs, and resource lifetime: keep intent, variation, and failure at clear boundaries.",
    },
    question: {
      "zh-CN": "抽象怎样保留后端能力，同时不把复杂度转嫁给调用者？",
      en: "How can an abstraction preserve backend capability without exporting its complexity?",
    },
  },
  {
    id: "gpu-compute",
    order: 3,
    code: "MOD_03",
    title: { "zh-CN": "GPU Compute", en: "GPU Compute" },
    description: {
      "zh-CN": "从工作组与数据布局到间接绘制：用测量而不是粒子数量讨论性能。",
      en: "From workgroups and data layout to indirect draws: discuss performance through measurements, not counts.",
    },
    question: {
      "zh-CN": "当 GPU 工作负载变慢时，应该先测量哪一个边界？",
      en: "Which boundary should be measured first when GPU work becomes slow?",
    },
  },
  {
    id: "ray-tracing",
    order: 4,
    code: "MOD_04",
    title: { "zh-CN": "光线追踪", en: "Ray Tracing" },
    description: {
      "zh-CN": "从 BVH 到线性累积：将随机采样、几何求交与历史重置变成可检查的渲染过程。",
      en: "From BVHs to linear accumulation: inspect random sampling, geometry queries, and history resets.",
    },
    question: {
      "zh-CN": "如何让渐进式渲染在参数变化后保持正确，而不是累积错误的历史？",
      en: "How can progressive rendering stay correct after a parameter change instead of accumulating stale history?",
    },
  },
  {
    id: "debugging",
    order: 5,
    code: "MOD_05",
    title: { "zh-CN": "调试与可观察性", en: "Debugging & Observability" },
    description: {
      "zh-CN": "G-Buffer、帧检查器与故障边界：让画面问题回到可定位的资源和 Pass。",
      en: "G-buffers, frame inspection, and failure boundaries: return visual problems to traceable resources and passes.",
    },
    question: {
      "zh-CN": "当最终画面异常时，怎样快速定位到对应的资源、阶段和状态转换？",
      en: "When a final frame is wrong, how can it be traced quickly to its resource, stage, and state transition?",
    },
  },
  {
    id: "neural-graphics",
    order: 6,
    code: "MOD_06",
    title: { "zh-CN": "神经图形", en: "Neural Graphics" },
    description: {
      "zh-CN": "让训练数据、模型导出与浏览器推理共享同一条可复现的证据链。",
      en: "Connect training data, model export, and browser inference through one reproducible evidence chain.",
    },
    question: {
      "zh-CN": "在模型真正可用之前，怎样诚实地展示学习、验证与降级？",
      en: "How can learning, validation, and fallbacks be shown honestly before a model is production-ready?",
    },
  },
  {
    id: "multimedia",
    order: 7,
    code: "ADJACENT_01",
    adjacent: true,
    title: { "zh-CN": "多媒体系统", en: "Multimedia Systems" },
    description: {
      "zh-CN": "解码、颜色、队列与时钟：追踪一帧媒体从输入到呈现的所有权。",
      en: "Decode, color, queues, and clocks: trace media-frame ownership from input to presentation.",
    },
    question: {
      "zh-CN": "如何在零拷贝、背压与音画同步之间建立可调试的数据路径？",
      en: "How can a debuggable data path balance zero-copy, backpressure, and A/V sync?",
    },
  },
] as const;

export function getWritingModule(moduleId: string): WritingModule | undefined {
  return writingModules.find((module) => module.id === moduleId);
}

export function isWritingModuleId(value: string): value is WritingModuleId {
  return writingModuleIds.some((moduleId) => moduleId === value);
}

export function writingModulePath(moduleId: WritingModuleId, locale: Locale): string {
  const prefix = locale === "en" ? "/en" : "";
  return `${prefix}/writing/modules/${moduleId}/`;
}
