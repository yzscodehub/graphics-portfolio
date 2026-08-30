---
routeSlug: render-graph
translationKey: render-graph
locale: en
title: Render Graph Explorer
summary: Explore pass dependencies, resource lifetimes, culling, and transient aliasing through an interactive graph.
category: engine
renderer: TypeScript + SVG
backend: svg
status: in-progress
featured: true
capabilities: []
requirements: []
controls:
  - Select Pass
  - Toggle Pass
  - Show Resource Lifetime
  - Show Aliasing
  - Reset Graph
metrics: []
fallbackImage: /media/placeholders/demo-render-graph.svg
relatedProjects:
  - engine-systems-explorer
relatedArticles:
  - render-graph-lifetime
draft: false
---

## What it demonstrates

This GPU-independent architecture demo highlights inputs, outputs, and dependencies when a pass is selected. Disabling a branch that does not contribute to the final output causes the required subgraph to be recomputed.

## Observable information

The resource panel shows first write, last read, and reusable intervals. It describes a declarative render-graph analysis; it is not a real API capture or hardware timeline. Memory savings remain hypotheses until validated against a backend.
