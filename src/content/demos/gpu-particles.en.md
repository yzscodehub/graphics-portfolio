---
routeSlug: gpu-particles
translationKey: gpu-particles
locale: en
title: GPU Compute Particles
summary: Update a single particle storage buffer with raw WebGPU and WGSL, with a labeled Canvas fallback.
category: gpu
renderer: Raw WebGPU + WGSL / Canvas 2D fallback
backend: raw-webgpu
status: idea
featured: true
capabilities:
  - webgpu
requirements:
  - WebGPU preferred
  - Canvas 2D fallback when WebGPU is unavailable
controls:
  - 25K particles
  - 100K particles
  - 250K particles
metrics: []
fallbackImage: /media/placeholders/demo-gpu-particles.svg
relatedProjects:
  - webgpu-compute-lab
relatedArticles:
  - compute-geometry-performance
  - webgpu-particles-path-tracing
draft: false
---

## What it demonstrates

Particle state lives in one read_write storage buffer. A compute pass updates it in place, then a render pass draws the same buffer as points. The implementation reports backend and particle count; it does not expose an independent GPU timer or a compute-versus-total timing split.

## Fallback behavior

When WebGPU is unavailable, the page creates a reduced Canvas 2D preview and labels it as such. The three count buttons recreate the renderer at the selected count. Ping-Pong state, indirect drawing, attractor/noise controls, and an independent GPU timing path are follow-up work rather than current features.
