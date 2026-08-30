---
routeSlug: frame-inspector
translationKey: frame-inspector
locale: en
title: Frame Inspector
summary: Inspect six labeled Canvas 2D procedural buffer views through explicit view switching.
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
  - SSAO
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

The page draws six procedural tiles labelled Final, Normal, Depth, Velocity, Lighting, and SSAO. They are deterministic visual probes for naming and interaction; no WebGPU device, MRT attachment, captured frame, or production buffer is involved.

## Engineering boundary

Clicking a tile or its control selects the active probe and updates the Canvas status line. A real WebGPU/MRT frame inspector and captured Buffer atlas remain a future route; this implementation is available on baseline Canvas 2D.
