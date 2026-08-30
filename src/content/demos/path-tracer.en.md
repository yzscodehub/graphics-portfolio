---
routeSlug: path-tracer
translationKey: path-tracer
locale: en
title: Progressive Path Tracer
summary: Trace a small scene with raw WebGPU, covering BVH traversal, progressive sampling, and accumulation.
category: gpu
renderer: Raw WebGPU + WGSL
backend: raw-webgpu
status: idea
featured: false
capabilities:
  - webgpu
requirements:
  - WebGPU
controls:
  - Samples Per Pixel
  - "Bounce Limit: 1–4"
  - "Material: Diffuse / Metal / Dielectric"
  - Accumulation Reset
  - Pause / Restart
metrics: []
fallbackImage: /media/placeholders/demo-path-tracer.svg
relatedProjects:
  - webgpu-compute-lab
relatedArticles:
  - webgpu-particles-path-tracing
draft: false
---

## What it demonstrates

The CPU builds a BVH for a small Cornell-style scene. The GPU generates samples into an accumulation texture. Camera, material, resolution, or bounce changes must clear historical samples; otherwise incompatible projections are mixed into the result.

## Explicit limits

This is a prototype for resources, sampling, and reset logic. It does not include production light sampling, a compressed BVH, or denoising. A four-bounce limit keeps interaction practical and is not a claim about offline quality or hardware performance.
