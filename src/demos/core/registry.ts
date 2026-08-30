import type { DemoLoader } from "./types";

export const demoRegistry: Record<string, DemoLoader> = {
  "material-lighting": {
    definition: {
      slug: "material-lighting",
      backend: "three-webgl",
      capabilities: ["webgl2"],
      relatedProjects: ["real-time-rendering-lab"],
    },
    load: () => import("../material-lighting"),
  },
  "render-graph": {
    definition: {
      slug: "render-graph",
      backend: "canvas-2d",
      capabilities: [],
      relatedProjects: ["engine-systems-explorer"],
    },
    load: () => import("../render-graph"),
  },
  "gpu-particles": {
    definition: {
      slug: "gpu-particles",
      backend: "raw-webgpu",
      capabilities: ["webgpu"],
      relatedProjects: ["webgpu-compute-lab"],
    },
    load: () => import("../gpu-particles"),
  },
  "shadow-aa": {
    definition: {
      slug: "shadow-aa",
      backend: "canvas-2d",
      capabilities: [],
      relatedProjects: ["real-time-rendering-lab"],
    },
    load: () => import("../shadow-aa"),
  },
  "path-tracer": {
    definition: {
      slug: "path-tracer",
      backend: "raw-webgpu",
      capabilities: ["webgpu"],
      relatedProjects: ["webgpu-compute-lab"],
    },
    load: () => import("../path-tracer"),
  },
  "frame-inspector": {
    definition: {
      slug: "frame-inspector",
      backend: "canvas-2d",
      capabilities: [],
      relatedProjects: ["engine-systems-explorer"],
    },
    load: () => import("../frame-inspector"),
  },
  "neural-denoising": {
    definition: {
      slug: "neural-denoising",
      backend: "onnx-web",
      capabilities: ["wasm"],
      relatedProjects: ["neural-graphics-lab"],
    },
    load: () => import("../neural-denoising"),
  },
};

export type DemoSlug = keyof typeof demoRegistry;
