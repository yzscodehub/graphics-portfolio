---
routeSlug: frame-inspector
translationKey: frame-inspector
locale: en
title: Frame Inspector
summary: Inspect ten real raw-WebGPU attachments, including a Reference Frame-local Cluster Light Count and the Temporal Resolve reject mask, with live Pixel Probe, low-frequency 64-bin histogram readback, freeze control, and an accessible Canvas atlas fallback.
category: engine
renderer: Raw WebGPU attachments / Canvas 2D atlas fallback
backend: raw-webgpu
status: in-progress
maturity: in-progress
evidence: verified
backends:
  - id: raw-webgpu
    label: Shared raw WebGPU reference frame
    role: primary
    capabilities:
      - webgpu
  - id: canvas-2d
    label: Deterministic Canvas 2D attachment atlas
    role: fallback
    capabilities: []
capabilities:
  - webgpu
requirements:
  - label: WebGPU
    required: false
    capability: webgpu
  - label: Canvas 2D fallback
    required: false
fallback:
  kind: canvas-2d
  description: A deterministic attachment atlas remains available when the shared WebGPU reference frame cannot initialize.
  image: /media/demos/frame-inspector-poster.svg
controls:
  - FINAL
  - ALBEDO + METALNESS
  - NORMAL + ROUGHNESS
  - LINEAR DEPTH
  - VELOCITY
  - HDR LIGHTING
  - SSAO
  - TAA HISTORY
  - HISTORY REJECT
  - CLUSTER LIGHT COUNT
  - FREEZE FRAME / RESUME FRAME
  - PIXEL PROBE
  - HISTOGRAM 64
metrics: []
metricSource:
  kind: runtime
  description: The inspector reports active backend, attachment format, range, last writer, and history state. Pixel Probe and Histogram 64 use low-frequency readback of real GPU attachments; no fixed performance number is published.
currentLimit: The attachments currently come from the analytical Reference Frame rather than the packed Research Courtyard; Final/Canvas views cannot be read back and this is not a complete RenderDoc replacement.
fallbackImage: /media/demos/frame-inspector-poster.svg
relatedProjects:
  - engine-systems-explorer
  - real-time-rendering-lab
relatedArticles:
  - render-graph-lifetime
  - frame-inspector-observability
  - shadow-temporal-aa
  - rhi-abstraction-boundaries
  - clustered-deferred-lighting
assetIds:
  - reference-frame-procedural
modes:
  - attachments
  - probe
referenceScene: reference-frame-procedural
sourceUrl: https://github.com/yzscodehub/graphics-portfolio/blob/main/src/demos/frame-inspector.ts
draft: false
---

## What runs

The raw WebGPU path shares a reference frame with the Shadow & Anti-Aliasing study and exposes ten attachments: Final, Albedo + Metalness, Normal + Roughness, Linear Depth, Velocity, HDR Lighting, SSAO, TAA History, History Reject, and Cluster Light Count. The reject attachment is written by Temporal Resolve: white means no usable history, UV bounds rejection, or depth rejection; black means accepted history. Final uses the browser's preferred canvas format; every other label reports its concrete format, range, and last writer. History reports warming, valid, or TAA-disabled state and identifies ACES + sRGB as a display-only transform over linear HDR.

Cluster Light Count is an `r8unorm` texture written by a Reference Frame pass after G-Buffer. It quantizes the same camera/depth contract into 8×5×8 local clusters, intersects eight analytic proxy lights, and stores the count normalized by eight. Pixel Probe and Histogram 64 read this texture directly. It is not, and does not claim to be, a texture imported from the separate Clustered / Deferred Lighting demo.

## Freeze and selection

Selecting an attachment changes only the display view. Freeze stops the render loop and keeps the current textures for inspection; Resume allows the shared frame to advance again. A visibility pause resets temporal history on resume so it is not reused across a time discontinuity. Device loss falls back to a deterministic sibling Canvas atlas with the same attachment vocabulary.
The first device loss attempts one generation-guarded Reference Frame rebuild and restarts attachment history. A failed rebuild or second loss falls back to the deterministic sibling Canvas atlas.

Pixel Probe reads the selected non-Final attachment at the clicked location through an explicit GPU copy/readback. Histogram 64 makes a low-frequency whole-attachment copy and bins sampled values; HDR Lighting and TAA History use log-luminance bins, while Velocity uses scaled magnitude. Neither operation is available for Final or Canvas fallback, because those paths do not expose the same source attachment.

## Evidence boundary

The attachments are real resources in the reference WebGPU frame, not a claim that the Canvas fallback contains captured production buffers. Cluster Heatmap remains deliberately absent: it belongs to the separate Clustered / Deferred Lighting renderer, which does not share a GPU device or resource interface with this Reference Frame. The local Cluster Light Count attachment is a separately written diagnostic derived from this frame's own depth and analytic-light contract. The inspector reports state and provenance rather than pretending to be a complete RenderDoc replacement.
