---
routeSlug: gpu-particles
translationKey: gpu-particles
locale: en
title: GPU Compute Particles
summary: Update particle state on the GPU with raw WebGPU and WGSL, making buffers, dispatch, and frame time visible.
category: gpu
renderer: Raw WebGPU + WGSL
backend: raw-webgpu
status: idea
featured: true
capabilities:
  - webgpu
requirements:
  - WebGPU
controls:
  - "Particle Count: 25K / 100K / 250K"
  - Attractor Strength
  - Noise Field
  - Quality Level
  - Pause / Reset
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

Particle state lives in storage buffers. A compute shader reads one Ping-Pong buffer and writes the next before a render pass consumes the result. The panel reports compute time separately from total frame time so browser composition is not confused with shader work.

## Fallback behavior

When WebGPU is unavailable, the page shows a recording and the same parameter notes. Mobile defaults to a smaller particle count; dispatch and animation stop when the page leaves the viewport or becomes hidden.
