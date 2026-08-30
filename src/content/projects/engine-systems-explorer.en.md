---
routeSlug: engine-systems-explorer
translationKey: engine-systems-explorer
locale: en
title: Engine Systems Explorer
summary: An interactive explanation of how a modern rendering runtime organizes render graphs, resource lifetimes, and frame inspection.
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
  - Designed a data model for passes, resources, and dependencies
  - Made first-use, last-use, and aliasing decisions visible
  - Turned low-level engine concepts into observable, reproducible cases
featureSlugs:
  - render-graph
  - pass-culling
  - resource-lifetime
  - frame-inspector
demoSlugs:
  - render-graph
  - frame-inspector
articleSlugs:
  - rhi-abstraction-boundaries
  - render-graph-lifetime
architecture: A small graph model describes passes and resources. SVG renders the relationships while independent analysis functions calculate topology, required passes, and resource intervals.
metrics: []
limitations:
  - The current visual model does not submit real GPU commands; it explains scheduling and resource decisions
  - Aliasing still needs backend validation before any peak-memory benefit can be claimed
draft: false
---

## Project outcome

Renderer complexity comes not only from shaders but from the relationships among resources and passes in one frame. This project turns those relationships from implicit call order into an inspectable graph: disable a pass to see dependencies shrink, or select a resource to inspect the interval between its first write and final read.

## Why it exists

Direct render calls work for a small demo. Once post-processing, shadows, transparency, debug views, and asynchronous work coexist, manually maintaining render targets and synchronization becomes fragile. A render graph separates the desired outputs from resource scheduling so compilation can perform pass culling, state inference, and transient reuse.

## Core model

Each pass declares the logical resources it reads and writes instead of owning a concrete GPU object. Compilation keeps the passes reachable from final outputs, derives a topological order from read/write edges, and scans first/last use to assign reusable intervals to compatible transient resources.

```text
Shadow ──writes──> ShadowMap ──reads──> Lighting
GBuffer ──writes──> Normals ──reads──> Lighting
Lighting ──writes──> HDR ──reads──> Bloom ──reads──> Tonemap
```

The visualizer does not claim to be a particular engine. It exposes boundaries and decisions: pass inputs and outputs, resource states, optional branches, and the pruning that occurs when a branch cannot contribute to a target output.

## Engineering questions

- A resource handle expresses logical identity and should not be retained across frames without an explicit lifetime rule.
- Read/write declarations must be precise or topology and barrier inference become misleading.
- Debug views should be formal output nodes rather than an escape hatch around the graph.
- Aliasing must consider format, size, usage, and parallel execution constraints together.

## Current boundary

This is an explanatory tool, not a hardware timeline. A real backend still needs RenderDoc, API captures, and timestamp queries to validate barriers, queue synchronization, and peak memory. The next step is mapping the same declarations to WebGPU render and compute passes while preserving a readable intermediate representation.
