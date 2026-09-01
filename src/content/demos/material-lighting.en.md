---
routeSlug: material-lighting
translationKey: material-lighting
locale: en
title: Material & Color Pipeline
summary: Inspect a Three.js WebGPURenderer and TSL PBR calibration scene with WebGL2 and Canvas fallbacks.
category: rendering
renderer: Three.js WebGPURenderer + TSL
backend: three-webgpu
status: in-progress
maturity: in-progress
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
  - "Preset: Dielectric / Metal / Rough / Clearcoat"
  - Base Color
  - Metalness
  - Roughness
  - Clearcoat
  - Clearcoat Roughness
  - Exposure
  - "Tone Mapping: ACES / AgX / LINEAR"
  - "View: FINAL / NORMAL / ROUGHNESS / METALNESS / DIRECT ISOLATION / IBL ISOLATION"
metrics: []
metricSource:
  kind: runtime
  description: The panel reports the active backend and requestAnimationFrame cadence; no fixed cross-device GPU timing claim is published.
currentLimit: Real WebGPU hardware evidence is still pending; Direct/IBL are lighting-isolation views rather than captured render attachments, and frame cadence is not a portable GPU benchmark.
fallbackImage: /media/demos/material-lighting-poster.svg
relatedProjects:
  - real-time-rendering-lab
relatedArticles:
  - material-lighting-color-pipeline
assetIds:
  - calibration-rig
modes:
  - pbr-calibration
  - debug-view
referenceScene: calibration-rig
sourceUrl: https://github.com/yzscodehub/graphics-portfolio/blob/main/src/demos/material-lighting.ts
draft: false
---

## What runs

The live path loads and validates the local Calibration Rig contract, then builds its sphere, rounded cube, metal ring, thin sheet, normal-groove object, roughness plane, procedural PMREM room, lights, and orbit camera. The controlled objects share a `MeshPhysicalNodeMaterial`, so preset and debug-view changes keep one repeatable scene contract.

## Controls and fallback

Dielectric, Metal, Rough, and Clearcoat presets set exact Base Color, Metalness, Roughness, Clearcoat, and Clearcoat Roughness values. Those parameters, Exposure, and ACES/AgX/Linear tone mapping are wired to the live renderer and mirrored by the Canvas approximation. Three.js may select WebGL2 internally when WebGPU is unavailable; if the multi-backend renderer itself fails, the page switches to the labeled Canvas approximation.

## Evidence boundary

This Demo verifies material parameters and lighting-isolation behavior. Direct Isolation disables the PMREM environment, while IBL Isolation disables direct lights; neither is presented as a captured attachment. The metric panel reports backend and frame cadence, not a universal GPU benchmark.

On the first WebGPU device or WebGL context loss, the controller disposes the previous renderer and attempts one generation-guarded Three.js rebuild. A failed rebuild or second loss switches to the labeled Canvas approximation.
