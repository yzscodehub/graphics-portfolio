---
routeSlug: material-lighting
translationKey: material-lighting
locale: en
title: Material & Lighting Lab
summary: Inspect PBR materials, direct light, IBL, exposure, and tone mapping in a repeatable calibration scene.
category: rendering
renderer: Three.js WebGLRenderer + PMREM
backend: three-webgl
status: in-progress
featured: true
capabilities:
  - webgl2
requirements:
  - WebGL2 (Canvas fallback)
controls:
  - Base Color
  - Metalness / Roughness
  - Environment Intensity
  - Exposure / Tone Mapping
  - Debug View
metrics: []
fallbackImage: /media/placeholders/demo-material-lighting.svg
relatedProjects:
  - real-time-rendering-lab
relatedArticles:
  - rhi-abstraction-boundaries
draft: false
---

## What it demonstrates

This compact calibration scene makes material parameters and the color pipeline observable. Switch between Base Color, Normal, Roughness, Metalness, Direct Lighting, and Indirect Lighting views to isolate a change.

## Interaction boundary

The camera and explicit parameters are local to the page; no rendered image is uploaded. WebGPU is attempted first, with a WebGL2 fallback when initialization fails. Performance numbers are measured on the current device and are not cross-device claims.
