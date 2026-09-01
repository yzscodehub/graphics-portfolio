---
routeSlug: clustered-lighting
translationKey: clustered-lighting
locale: en
title: Clustered / Deferred Lighting
summary: Compare Naive Forward, Deferred, and Clustered Lighting in one Research Courtyard while inspecting G-Buffer data, depth slices, cluster light lists, overflow, and honest metric sources.
category: rendering
renderer: Raw WebGPU / Canvas 2D fallback
backend: raw-webgpu
status: in-progress
maturity: in-progress
evidence: measured
backends:
  - id: raw-webgpu
    label: Raw WebGPU clustered renderer
    role: primary
    capabilities:
      - webgpu
  - id: canvas-2d
    label: Deterministic cluster heatmap fallback
    role: fallback
    capabilities: []
capabilities:
  - webgpu
requirements:
  - label: WebGPU
    required: false
    capability: webgpu
  - label: timestamp-query
    required: false
fallback:
  kind: canvas-2d
  description: When WebGPU is unavailable, a labeled Research Courtyard, depth-slice, and cluster-occupancy view remains available without impersonating a live G-Buffer.
  image: /media/demos/clustered-lighting-poster.svg
controls:
  - NAIVE
  - DEFERRED
  - CLUSTERED
  - 64 LIGHTS
  - 256 LIGHTS
  - 512 LIGHTS
  - FINAL
  - G-BUFFER
  - DEPTH SLICE
  - CLUSTER HEATMAP
metrics:
  - label: REFERENCE HARDWARE
    value: Windows 11 / RTX 4070 class / Chromium Stable / 1080p / DPR 1.0
    status: verified
    source: declared acceptance environment
metricSource:
  kind: runtime
  description: GPU geometry, Compute assignment, and lighting time are reported only when timestamp-query is available. A low-frequency 64-light CPU reference readback checks GPU list membership and overflow separately.
currentLimit: Naive, Deferred, and Clustered now use separate pass DAGs, but this proxy courtyard has not completed real-WebGPU hardware validation; the packed scene is not yet connected, and Frame Inspector does not share this renderer's heatmap or GPU resources.
fallbackImage: /media/demos/clustered-lighting-poster.svg
relatedProjects:
  - real-time-rendering-lab
relatedArticles:
  - clustered-deferred-lighting
  - frame-inspector-observability
assetIds:
  - clustered-courtyard-proxy
modes:
  - naive
  - deferred
  - clustered
referenceScene: research-courtyard
sourceUrl: https://github.com/yzscodehub/graphics-portfolio/blob/main/src/demos/clustered-lighting.ts
draft: false
---

## One scene, three lighting paths

Naive Forward evaluates every dynamic light per shaded pixel. Deferred first writes Albedo, Normal, and Depth attachments before a screen-space lighting pass. Clustered partitions the view frustum and evaluates only the light list assigned to the current cluster. Camera, materials, animated lights, and display transform remain identical across all three modes.

## Inspectable intermediate evidence

Alongside Final, the page exposes a G-Buffer visualization, Depth Slice, and a lights-per-cluster heatmap. A Raw WebGPU Compute pass writes fixed-offset cluster headers, light indices, and overflow. Runtime status reports light count, GPU overflow readback, low-frequency 64-light CPU/GPU verification, and metric source.

## Current boundary

This study does not implement Hi-Z, meshlets, transparent clustered-forward shading, a shadow atlas, or a general glTF editor. The current runtime uses a self-authored procedural Research Courtyard; the separately audited asset manifest reserves a later packed-scene path. Cluster Heatmap belongs only to this standalone renderer. Frame Inspector currently uses an independent Reference Frame and does not claim to display this heatmap or share its GPU resources.

The first current-generation device loss rebuilds the selected mode, light count, and view once. A failed rebuild or second loss enters the labeled Canvas diagnostic fallback.
