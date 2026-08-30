---
routeSlug: path-tracer
translationKey: path-tracer
locale: en
title: Progressive Path Study
summary: Study a small full-screen progressive path-like image with raw WebGPU and a labeled Canvas fallback.
category: gpu
renderer: Raw WebGPU + WGSL / Canvas 2D fallback
backend: raw-webgpu
status: idea
featured: false
capabilities:
  - webgpu
requirements:
  - WebGPU preferred
  - Canvas 2D fallback when WebGPU is unavailable
controls:
  - 2 BOUNCES
  - 3 BOUNCES
  - 4 BOUNCES
metrics: []
fallbackImage: /media/placeholders/demo-path-tracer.svg
relatedProjects:
  - webgpu-compute-lab
relatedArticles:
  - webgpu-particles-path-tracing
draft: false
---

## What it demonstrates

The WebGPU fragment shader draws a full-screen procedural room with an analytic floor and two spheres, then blends a jittered path-like estimate into two color textures. The only exposed control is the maximum bounce count; there is no CPU-built BVH, material selector, Samples Per Pixel control, or explicit reset button.

## Explicit limits

This is a visual study of shader resources and progressive accumulation, not a production path tracer. The fallback is a procedural Canvas 2D scene and reports visual samples rather than GPU timing. Production light sampling, a BVH, material variants, explicit reset controls, and denoising remain future work.
