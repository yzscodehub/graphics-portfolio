---
routeSlug: material-lighting
translationKey: material-lighting
locale: en
title: Material & Lighting Lab
summary: Inspect a Three.js WebGL PBR calibration scene with a clearly labeled Canvas 2D fallback.
category: rendering
renderer: Three.js WebGLRenderer + PMREM
backend: three-webgl
status: in-progress
featured: true
capabilities:
  - webgl2
requirements:
  - WebGL2 preferred
  - Canvas 2D fallback when WebGL initialization fails
controls:
  - Metallic
  - Roughness
  - Exposure
  - "Debug: Final / Normal / Roughness"
metrics: []
fallbackImage: /media/placeholders/demo-material-lighting.svg
relatedProjects:
  - real-time-rendering-lab
relatedArticles:
  - rhi-abstraction-boundaries
draft: false
---

## What it demonstrates

This compact calibration scene makes three implemented material controls and three debug views observable. A moving key light, a PMREM-generated room environment, and the orbit camera stay inside the Three.js WebGL path; the fallback is a labeled procedural Canvas approximation.

## Interaction boundary

The camera and explicit parameters are local to the page; no rendered image is uploaded. WebGL2 is attempted first, and Canvas 2D takes over when the Three.js renderer cannot initialize. WebGPU/TSL is a future route, not a current backend. The panel reports `requestAnimationFrame` cadence rather than claiming GPU timing.
