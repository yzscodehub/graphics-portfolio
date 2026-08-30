---
routeSlug: engine-systems-explorer
translationKey: engine-systems-explorer
locale: en
title: Engine Systems Explorer
summary: A TypeScript render-graph compiler made observable through an accessible SVG execution plan.
year: 2026
status: completed
role: Independent development / graphics systems design
platforms:
  - Web
  - TypeScript
technologies:
  - Render Graph
  - SVG
  - Resource Lifetime
  - Transient Aliasing
  - Usage Planning
heroImage: /media/projects/engine-systems-explorer-cover.svg
architectureImage: /media/projects/engine-systems-explorer-architecture.svg
architectureAlt: "Data flow from render-graph declaration through validation, culling, topology, lifetimes, aliasing, and inspection."
demoImage: /media/runtime/engine-systems-explorer-runtime.png
demoImageAlt: "Live Render Graph Explorer capture showing six live passes, one culled pass, and transient alias slots."
environment:
  - "Capture OS: Windows NT 10.0 x64"
  - "Browser: Chromium 151.0.7922.34, 1600x1000 CSS px, DPR 1"
  - "Backend: TypeScript + DOM/SVG; no GPU adapter required"
  - "Evidence boundary: visual and CPU compile plan, not a hardware GPU timeline"
reproduction: "Open Render Graph Explorer and toggle any pass; verify diagnostics, topology, lifetimes, alias slots, and usage transitions update together."
responsibilities:
  - Models versioned resources, read/write uses, and pass dependencies
  - Compiles roots, validation diagnostics, culling, topology, lifetimes, alias slots, and usage transitions
  - Presents the plan as keyboard-accessible, selectable SVG nodes
featureSlugs:
  - graph-validation
  - topological-schedule
  - pass-culling
  - resource-lifetime
  - transient-aliasing
  - usage-transitions
demoSlugs:
  - render-graph
  - frame-inspector
articleSlugs:
  - rhi-abstraction-boundaries
  - render-graph-lifetime
  - frame-inspector-observability
evidence: measured
backends:
  - id: svg
    label: TypeScript compiler + accessible SVG inspector
    role: primary
    capabilities: []
requirements:
  - label: DOM and SVG
    required: true
fallback:
  kind: none
  description: The compiler and inspector are GPU-independent.
metricSource:
  kind: runtime
  description: Compile time is measured with a CPU wall-clock timer; no hardware GPU timing is claimed.
metrics: []
architecture: A declaration layer describes resources and passes; compilation validates, finds roots, prunes unreachable work, sorts the schedule, computes lifetimes, assigns compatible transient aliases, and records logical usage transitions.
limitations:
  - The graph compiles and visualizes plans but does not submit backend GPU commands
  - Usage transitions are planning metadata and require backend validation before production use
draft: false
---

## What runs

The project turns a render-graph declaration into an inspectable execution plan. The demo contains versioned resources for depth, G-Buffer attachments, SSAO, HDR lighting, temporal history, present, and a debug overlay. Each pass declares its reads and writes; the compiler derives the relationships rather than relying on hand-written call order.

## Compiler evidence

Validation catches duplicate resources and passes, invalid descriptors, unknown resources, missing producers, unknown versions, and cycles. Enabled passes are traced back from Present and side-effect roots, unreachable work is reported as culled, and the live schedule is topologically sorted. Each resource version receives first/last use positions, reader/writer information, and a compatible transient alias slot when its interval does not overlap another allocation.

The inspector renders live and culled nodes as accessible SVG groups. Passes are selectable with pointer or keyboard input, and the panel exposes dependencies, resource versions, lifetime positions, alias slots, and usage transitions.

## Boundary

The CPU wall-clock value describes this small compiler run; it is not a GPU timestamp. The plan is ready to map into a backend, but barrier emission, queue ownership, and actual memory behavior still need API-specific validation.
