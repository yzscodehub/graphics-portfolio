---
routeSlug: frame-inspector
translationKey: frame-inspector
locale: en
title: Frame Inspector
summary: Inspect a frame through geometry, depth, lighting, and final-color buffers with explicit view switching.
category: engine
renderer: Canvas 2D buffer visualization
backend: canvas-2d
status: in-progress
featured: false
capabilities: []
requirements:
  - Baseline Canvas 2D
controls:
  - Final
  - Normal
  - Depth
  - Velocity
  - Lighting
  - SSAO / Tone Map
metrics: []
fallbackImage: /media/placeholders/demo-frame-inspector.svg
relatedProjects:
  - engine-systems-explorer
  - real-time-rendering-lab
relatedArticles:
  - render-graph-lifetime
draft: false
---

## What it demonstrates

Debug views turn “the frame looks wrong” into inspectable intermediate results. Normal checks orientation and tangent-space assumptions, Depth keeps nonlinear depth explicit, and Velocity plus history buffers help explain temporal ghosting.

## Engineering boundary

View switching selects a formal render output; it does not bypass the demo's resource lifetime. When WebGPU initialization fails, a precomputed buffer atlas and text explanation remain available.
