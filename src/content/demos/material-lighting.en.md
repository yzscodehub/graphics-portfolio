---
routeSlug: material-lighting
translationKey: material-lighting
locale: en
title: Material & Lighting Lab
summary: Inspect a Three.js WebGPURenderer and TSL PBR calibration scene with WebGL2 and Canvas fallbacks.
category: rendering
renderer: Three.js WebGPURenderer + TSL
backend: three-webgpu
status: completed
maturity: completed
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
capabilities:
  - webgpu
  - webgl2
requirements:
  - label: WebGPU preferred
    required: false
    capability: webgpu
  - label: WebGL2 automatic renderer fallback
    required: false
    capability: webgl2
  - label: Canvas 2D fallback on renderer failure
    required: false
fallback:
  kind: canvas-2d
  description: A procedural Canvas 2D material preview remains available when the Three.js multi-backend renderer cannot initialize.
  image: /media/demos/material-lighting-poster.svg
controls:
  - Base Color
  - Metallic
  - Roughness
  - Exposure
  - "Tone Mapping: ACES / AgX / LINEAR"
  - "Debug: FINAL / NORMAL / ROUGHNESS / METALNESS / DIRECT / INDIRECT"
metrics: []
metricSource:
  kind: runtime
  description: The panel reports the active backend and requestAnimationFrame cadence; no fixed cross-device GPU timing claim is published.
fallbackImage: /media/demos/material-lighting-poster.svg
relatedProjects:
  - real-time-rendering-lab
relatedArticles:
  - rhi-abstraction-boundaries
  - material-lighting-color-pipeline
draft: false
---

## What runs

The live path uses Three.js `WebGPURenderer` with TSL node materials. It builds a repeatable sphere, floor, procedural PMREM room, hemisphere light, moving directional light, rim light, and orbit camera. The material is a `MeshPhysicalNodeMaterial`, so the page can show normal, roughness, metalness, direct-light, and indirect-light views without changing the scene contract.

## Controls and fallback

Base Color, Metalness, Roughness, Exposure, and ACES/AgX/Linear tone mapping are wired to the live renderer. The same control family is kept in the Canvas fallback. Three.js may select WebGL2 internally when WebGPU is unavailable; if the multi-backend renderer itself fails, the page switches to the labeled Canvas approximation.

## Evidence boundary

This Demo verifies the material and debug-view behavior. The metric panel reports backend and frame cadence, not a universal GPU benchmark. It is a rendering study, not evidence that every device supports every Three.js WebGPU feature.
