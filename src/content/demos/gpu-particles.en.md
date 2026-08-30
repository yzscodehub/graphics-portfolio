---
routeSlug: gpu-particles
translationKey: gpu-particles
locale: en
title: GPU Compute Particles
summary: Update a ping-pong particle state with raw WebGPU and WGSL, including lifecycle, attractor, and optional timestamp-query evidence.
category: gpu
renderer: Raw WebGPU + WGSL / Canvas 2D fallback
backend: raw-webgpu
status: completed
maturity: completed
evidence: measured
backends:
  - id: raw-webgpu
    label: Raw WebGPU compute and render passes
    role: primary
    capabilities:
      - webgpu
  - id: canvas-2d
    label: Reduced deterministic Canvas 2D preview
    role: fallback
    capabilities: []
capabilities:
  - webgpu
requirements:
  - label: WebGPU
    required: false
    capability: webgpu
  - label: Timestamp-query feature (optional)
    required: false
    capability: webgpu
fallback:
  kind: canvas-2d
  description: A reduced Canvas 2D lifecycle preview preserves the controls and labels itself when WebGPU is unavailable.
  image: /media/demos/gpu-particles-poster.svg
controls:
  - 25K particles
  - 100K particles
  - 250K particles
  - Attractor range
  - Pointer attractor
  - Pause / Resume
  - Reset
metrics: []
metricSource:
  kind: runtime
  description: When timestamp-query is supported, compute and render durations are read back from GPU timestamps; otherwise the panel reports animation-frame status without a GPU-time claim.
fallbackImage: /media/demos/gpu-particles-poster.svg
relatedProjects:
  - webgpu-compute-lab
relatedArticles:
  - compute-geometry-performance
  - webgpu-particles-path-tracing
draft: false
---

## What runs

The WebGPU path keeps two particle buffers and alternates their read/write roles each frame. A Compute Pass updates position, velocity, age, lifetime, and seed; expired or escaped particles are respawned deterministically. A Render Pass consumes the written buffer and draws points whose color and alpha reflect remaining lifetime.

## Interaction and measurement

The count buttons rebuild the resource set for 25K, 100K, or 250K particles. Pointer movement controls the attractor, the range controls its strength, and Pause/Reset act on both the native and Canvas implementations. If the adapter exposes `timestamp-query`, the Demo resolves separate Compute and Render intervals and reports them with a `gpu-timestamp-query` source; otherwise it explicitly reports timing as unavailable.

## Fallback boundary

The Canvas fallback implements the same lifecycle and attractor concepts at a reduced scale. It is useful for inspection, but its animation-frame cadence must not be compared directly with native GPU timestamps.
