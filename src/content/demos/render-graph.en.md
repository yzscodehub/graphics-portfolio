---
routeSlug: render-graph
translationKey: render-graph
locale: en
title: Render Graph Explorer
summary: Compile a declaration-driven render graph into an accessible SVG schedule with culling, lifetimes, alias slots, and usage transitions.
category: engine
renderer: TypeScript compiler + accessible SVG inspector
backend: svg
status: completed
maturity: completed
evidence: measured
backends:
  - id: svg
    label: TypeScript compiler / accessible SVG
    role: primary
    capabilities: []
capabilities: []
requirements:
  - label: DOM and SVG
    required: true
fallback:
  kind: none
  description: The compiler and SVG inspector do not require a GPU fallback.
controls:
  - Depth Prepass
  - G-Buffer
  - SSAO
  - Lighting
  - Temporal Resolve
  - Present
  - Debug Overlay
  - Select a pass with click, Tab, Enter, or Space
metrics: []
metricSource:
  kind: runtime
  description: Compile time is measured with a CPU wall-clock timer; the inspector does not claim GPU execution time.
fallbackImage: /media/demos/render-graph-poster.svg
relatedProjects:
  - engine-systems-explorer
relatedArticles:
  - render-graph-lifetime
  - rhi-abstraction-boundaries
  - frame-inspector-observability
draft: false
---

## What runs

The Demo compiles a declaration-driven graph in TypeScript and renders the resulting schedule as accessible SVG. Pass nodes expose keyboard and pointer selection, while the inspector reports dependencies, resource versions, lifetimes, alias slots, and logical usage transitions.

## Compiler stages

The current compiler validates descriptors and references, rejects cycles, finds Present or side-effect roots, prunes enabled passes that are not reachable from those roots, topologically sorts the live schedule, computes first/last use intervals, assigns compatible transient alias slots, and records usage transitions. Toggling a pass recompiles the plan, so a disabled producer can surface a diagnostic instead of silently producing a misleading picture.

## Evidence boundary

`compileMs` is a CPU wall-clock measurement of this small graph. Usage transitions are backend planning metadata; WebGPU may satisfy compatible transitions implicitly. The Demo does not pretend to be a hardware GPU timeline.
