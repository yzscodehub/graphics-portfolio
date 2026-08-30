---
routeSlug: engine-systems-explorer
translationKey: engine-systems-explorer
locale: en
title: Engine Systems Explorer
summary: A Canvas 2D procedural entry point for render-runtime concepts; real graph compilation remains a follow-up route.
year: 2026
status: in-progress
role: Independent development / graphics systems design
platforms:
  - Windows
  - Web
technologies:
  - C++
  - Render Graph
  - RHI
  - GPU Profiling
heroImage: /media/placeholders/project-engine-systems-explorer.svg
responsibilities:
  - Draws a fixed pass-and-resource dependency preview
  - Exposes pass visibility and node selection as inspectable interaction
  - Documents the boundary between a visual prototype and a real graph compiler
featureSlugs:
  - pass-dependency-preview
  - pass-toggle-preview
  - node-selection
  - buffer-view-preview
demoSlugs:
  - render-graph
  - frame-inspector
articleSlugs:
  - rhi-abstraction-boundaries
  - render-graph-lifetime
architecture: The current demo draws fixed pass nodes and declared read/write relationships with Canvas 2D. Its controller handles selection and visibility; a real render-graph compiler is a follow-up route.
metrics: []
limitations:
  - The current model submits no GPU commands and does not provide an SVG graph, pass culling, resource-lifetime analysis, or transient aliasing
  - A node toggle is a visual preview, not compiler-level dependency pruning
  - A later route will connect real graph compilation, backend barriers, and memory measurement
draft: false
---

## Current preview

Renderer complexity comes not only from shaders but from the relationships among passes and resources in one frame. The current demo draws five fixed nodes, read/write labels, and selection state on Canvas 2D. Visitors can toggle node visibility and inspect the selected declaration.

## Boundary with a real engine

The implementation has no SVG graph, GPU commands, pass culling, resource-lifetime analysis, or aliasing. A node toggle changes the visual preview; it does not recompile and prune a dependency graph. A follow-up route can connect the declarations to a backend and use API captures and timestamp queries to validate barriers, queue synchronization, and memory behavior.
