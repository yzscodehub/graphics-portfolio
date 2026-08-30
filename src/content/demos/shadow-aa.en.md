---
routeSlug: shadow-aa
translationKey: shadow-aa
locale: en
title: Shadow & Anti-Aliasing Lab
summary: Compare shadow filtering and anti-aliasing strategies for edge quality, stability, and runtime cost in one scene.
category: rendering
renderer: Canvas 2D technique visualizer
backend: canvas-2d
status: in-progress
featured: false
capabilities: []
requirements:
  - Baseline Canvas 2D
controls:
  - Hard / PCF / PCSS
  - No AA / FXAA / TAA
  - Shadow Bias
  - Filter Radius
  - Camera Motion
metrics: []
fallbackImage: /media/placeholders/demo-shadow-aa.svg
relatedProjects:
  - real-time-rendering-lab
relatedArticles:
  - rhi-abstraction-boundaries
draft: false
---

## What it demonstrates

Hard shadows, PCF, and PCSS share the same light and receiver so sampling and penumbra assumptions can be inspected. The anti-aliasing modes focus on geometric edges and camera-motion stability; TAA needs history validity and velocity information rather than a simple blurred current frame.

## Compatibility

This demo intentionally keeps a traditional WebGLRenderer and GLSL path for comparison with the newer WebGPU path. A static comparison is shown when an advanced filter is unavailable.
