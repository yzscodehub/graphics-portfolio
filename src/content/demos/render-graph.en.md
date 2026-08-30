---
routeSlug: render-graph
translationKey: render-graph
locale: en
title: Render Graph Explorer
summary: Inspect a fixed Canvas 2D pass-dependency preview with visibility toggles and node selection.
category: engine
renderer: Canvas 2D procedural pass graph
backend: canvas-2d
status: in-progress
featured: true
capabilities: []
requirements:
  - Baseline Canvas 2D
controls:
  - Depth Prepass
  - G-Buffer
  - Lighting
  - Temporal AA
  - Tone Map
  - Select a visible node on the canvas
metrics: []
fallbackImage: /media/placeholders/demo-render-graph.svg
relatedProjects:
  - engine-systems-explorer
relatedArticles:
  - render-graph-lifetime
draft: false
---

## What it demonstrates

This GPU-independent Canvas 2D preview draws five fixed pass nodes and their declared read/write labels. Buttons toggle node visibility and clicking a visible node selects it; the current implementation does not compile or execute a real render graph.

## Observable boundary

The status line reports the selected node's declared reads and writes. It does not calculate first/last resource use, pass culling, SVG relationships, transient aliasing, barriers, or GPU timing. Those remain an explicit follow-up route for the Engine Systems project.
