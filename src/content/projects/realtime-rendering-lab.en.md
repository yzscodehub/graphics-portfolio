---
routeSlug: real-time-rendering-lab
translationKey: real-time-rendering-lab
locale: en
title: Real-Time Rendering Lab
summary: A completed Three.js WebGPURenderer and TSL material lab with automatic WebGL2 and Canvas fallbacks.
year: 2026
status: completed
role: Independent development / rendering engineer
platforms:
  - WebGPU
  - WebGL2
  - Canvas 2D fallback
technologies:
  - TypeScript
  - Three.js WebGPURenderer
  - TSL
  - MeshPhysicalNodeMaterial
  - PMREM
heroImage: /media/projects/real-time-rendering-lab-cover.svg
architectureImage: /media/projects/real-time-rendering-lab-architecture.svg
architectureAlt: "Data flow from material inputs and the TSL graph through multi-backend WebGPURenderer to debug output."
demoImage: /media/runtime/real-time-rendering-lab-runtime.png
demoImageAlt: "Live Material & Lighting capture on the WebGL2 fallback, using the same TSL material graph and PMREM scene."
environment:
  - "Capture OS: Windows NT 10.0 x64"
  - "Browser: Chromium 151.0.7922.34, 1600x1000 CSS px, DPR 1"
  - "Backend: Three.js r185 WebGPURenderer / WebGL2 fallback"
  - "Graphics device: ANGLE Vulkan / SwiftShader headless capture; not discrete-GPU performance evidence"
reproduction: "Open Material & Lighting and switch material values, exposure, tone mapping, and all six debug views; the backend label must match actual initialization."
responsibilities:
  - Builds a repeatable sphere, floor, PMREM room, moving key light, fill light, rim light, and orbit camera
  - Exposes Base Color, Metalness, Roughness, Exposure, tone mapping, and six debug views
  - Keeps renderer and Canvas fallback lifecycles explicit
featureSlugs:
  - pbr-materials
  - tsl-node-materials
  - tone-mapping
  - direct-indirect-debug
  - webgl2-fallback
demoSlugs:
  - material-lighting
  - shadow-aa
  - frame-inspector
articleSlugs:
  - material-lighting-color-pipeline
  - shadow-temporal-aa
  - frame-inspector-observability
evidence: verified
backends:
  - id: three-webgpu
    label: Three.js WebGPURenderer + TSL / WebGPU
    role: primary
    capabilities:
      - webgpu
  - id: three-webgl
    label: Three.js WebGPURenderer / WebGL2 fallback
    role: fallback
    capabilities:
      - webgl2
  - id: canvas-2d
    label: Procedural Canvas 2D fallback
    role: fallback
    capabilities: []
requirements:
  - label: WebGPU preferred
    required: false
    capability: webgpu
  - label: WebGL2 automatic renderer fallback
    required: false
    capability: webgl2
fallback:
  kind: canvas-2d
  description: A procedural Canvas material preview remains available if the Three.js multi-backend renderer fails.
  image: /media/projects/real-time-rendering-lab-cover.svg
metricSource:
  kind: runtime
  description: The Demo reports backend and frame cadence; it publishes no fixed cross-device GPU timing.
metrics: []
architecture: Three.js WebGPURenderer initializes a TSL node-material graph and internally falls back to WebGL2; a separate Canvas renderer handles total initialization failure.
limitations:
  - Browser driver differences can change the active backend and output precision
  - Shadow and anti-aliasing pipelines are documented by the shared reference-frame and Frame Inspector projects
draft: false
---

## What runs

The live scene uses `WebGPURenderer`, TSL nodes, `MeshPhysicalNodeMaterial`, a PMREM-generated room environment, and three lights. Base Color, Metalness, Roughness, Exposure, and ACES/AgX/Linear tone mapping are connected to the controls. Debug views switch between Final, Normal, Roughness, Metalness, Direct, and Indirect while retaining the same geometry and camera.

Three.js selects its WebGL2 backend when WebGPU is unavailable. If the multi-backend renderer cannot initialize at all, the page enters a labeled Canvas 2D approximation with the material controls preserved.

## Evidence boundary

This project verifies a practical PBR/TSL interaction path and backend fallback behavior. The runtime panel reports the active backend and animation-frame cadence, not a universal performance benchmark.
