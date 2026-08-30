---
routeSlug: path-tracer
translationKey: path-tracer
locale: en
title: Progressive Path Tracer
summary: Trace a procedural Cornell scene with a CPU median BVH, triangle/material buffers, linear rgba16float accumulation, and tone mapping.
category: gpu
renderer: Raw WebGPU compute + display / Canvas 2D fallback
backend: raw-webgpu
status: completed
maturity: completed
evidence: verified
backends:
  - id: raw-webgpu
    label: Raw WebGPU compute path tracer
    role: primary
    capabilities:
      - webgpu
  - id: canvas-2d
    label: CPU path-like Canvas 2D fallback
    role: fallback
    capabilities: []
capabilities:
  - webgpu
requirements:
  - label: WebGPU
    required: false
    capability: webgpu
  - label: rgba16float storage textures
    required: false
    capability: webgpu
fallback:
  kind: canvas-2d
  description: A labeled CPU path-like Canvas preview preserves bounce, pause, reset, and sample state when WebGPU is unavailable.
  image: /media/demos/path-tracer-poster.svg
controls:
  - 1 BOUNCE
  - 2 BOUNCES
  - 3 BOUNCES
  - 4 BOUNCES
  - Pause / Resume
  - Reset SPP
metrics: []
metricSource:
  kind: runtime
  description: The panel reports accumulated SPP and animation-frame status; it does not publish a fixed GPU timing number.
fallbackImage: /media/demos/path-tracer-poster.svg
relatedProjects:
  - webgpu-compute-lab
relatedArticles:
  - webgpu-particles-path-tracing
  - path-tracing-to-neural-denoising
draft: false
---

## What runs

The CPU constructs a small Cornell-style scene, median-splits its triangles into a BVH, and uploads encoded triangle, node, and material buffers. The WebGPU Compute Pass traces the scene, writes linear HDR samples to alternating `rgba16float` storage textures, and the display pass applies a separate tone map.

## Controls and accumulation

The four bounce buttons update the uniform contract and reset the sample counter. Pause keeps displaying the current accumulation without adding samples; Reset SPP clears the accumulation state and advances the camera revision. The panel exposes SPP and bounce count, while avoiding a universal quality or speed claim.

## Fallback boundary

The CPU Canvas path is intentionally labeled and uses a visual path-like approximation. It preserves the interaction contract, but its samples and frame cadence are not GPU measurements.
