---
routeSlug: frame-inspector
translationKey: frame-inspector
locale: en
title: Frame Inspector
summary: Inspect eight real raw-WebGPU attachments from one shared reference frame, with an accessible Canvas atlas fallback and freeze control.
category: engine
renderer: Raw WebGPU attachments / Canvas 2D atlas fallback
backend: raw-webgpu
status: completed
maturity: completed
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
  - FREEZE FRAME / RESUME FRAME
metrics: []
metricSource:
  kind: runtime
  description: The inspector reports active backend, attachment format, range, and last writer; it does not publish a fixed performance number.
fallbackImage: /media/demos/frame-inspector-poster.svg
relatedProjects:
  - engine-systems-explorer
  - real-time-rendering-lab
relatedArticles:
  - render-graph-lifetime
  - frame-inspector-observability
  - shadow-temporal-aa
draft: false
---

## What runs

The raw WebGPU path shares a reference frame with the Shadow & Anti-Aliasing study and exposes eight attachments: Final, Albedo + Metalness, Normal + Roughness, Linear Depth, Velocity, HDR Lighting, SSAO, and TAA History. Each label includes its format, range, and last writer.

## Freeze and selection

Selecting an attachment changes only the display view. Freeze stops the render loop and keeps the current textures for inspection; Resume allows the shared frame to advance again. Device loss falls back to a deterministic Canvas atlas with the same attachment vocabulary.

## Evidence boundary

The attachments are real resources in the reference WebGPU frame, not a claim that the Canvas fallback contains captured production buffers. The inspector reports state and provenance rather than pretending to be a complete RenderDoc replacement.
