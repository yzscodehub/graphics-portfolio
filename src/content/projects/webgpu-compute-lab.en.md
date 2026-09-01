---
routeSlug: webgpu-compute-lab
translationKey: webgpu-compute-lab
locale: en
title: WebGPU Compute Lab
summary: In-progress raw-WebGPU studies for particles, true three-LOD indirect visibility, and a BVH-backed progressive path tracer.
year: 2026
status: in-progress
role: Independent development / GPU systems engineering
platforms:
  - WebGPU
  - WGSL
  - Canvas 2D fallback
technologies:
  - TypeScript
  - WebGPU
  - WGSL
  - Storage Buffers
  - Timestamp Query
  - BVH
heroImage: /media/projects/webgpu-compute-lab-cover.svg
architectureImage: /media/projects/webgpu-compute-lab-architecture.svg
architectureAlt: "Dual-lane architecture for particle ping-pong compute/render and CPU-BVH/WGSL/HDR path integration."
demoImage: /media/runtime/webgpu-compute-lab-runtime.png
demoImageAlt: "Live deterministic Canvas fallback from GPU Compute Particles when the capture environment returned no WebGPU adapter."
environment:
  - "Capture OS: Windows NT 10.0 x64"
  - "Browser: Chromium 151.0.7922.34, 1600x1000 CSS px, DPR 1"
  - "Captured backend: requestAdapter returned null; labeled Canvas particle fallback"
  - "Primary-path requirement: WebGPU; timestamp-query is optional"
reproduction: "In a WebGPU browser select 25K/100K/250K, pause, reset, and move the attractor; without an adapter verify the fallback label and absence of invented GPU timing."
responsibilities:
  - Maintains ping-pong particle buffers, lifecycle respawn, pointer attractor, and optional GPU timestamps
  - Builds a median-split BVH and uploads triangles, nodes, and materials for path integration
  - Separates native resource paths from labeled Canvas fallbacks
featureSlugs:
  - ping-pong-particles
  - lifecycle-respawn
  - gpu-timestamp-query
  - median-bvh
  - progressive-accumulation
demoSlugs:
  - gpu-particles
  - path-tracer
articleSlugs:
  - compute-geometry-performance
  - webgpu-particles-path-tracing
  - gpu-driven-visibility-indirect
  - bvh-progressive-path-tracing
evidence: measured
backends:
  - id: raw-webgpu
    label: Raw WebGPU + WGSL compute/render
    role: primary
    capabilities:
      - webgpu
  - id: canvas-2d
    label: Reduced Canvas 2D fallback
    role: fallback
    capabilities: []
requirements:
  - label: WebGPU
    required: false
    capability: webgpu
  - label: Timestamp-query feature for GPU timings (optional)
    required: false
    capability: webgpu
fallback:
  kind: canvas-2d
  description: Reduced Canvas renderers preserve the particle and path-study interaction contracts when WebGPU is unavailable.
  image: /media/projects/webgpu-compute-lab-cover.svg
metricSource:
  kind: runtime
  description: Particle Compute/Render timings use timestamp-query when available; other states report animation-frame status without a GPU-time claim.
metrics: []
architecture: Particles use two storage buffers and alternate read/write bind groups. The path tracer uploads median-BVH nodes, triangles, and materials, integrates into two linear rgba16float textures, and applies tone mapping in a display pass.
limitations:
  - Timestamp-query is adapter-dependent and no cross-device timing number is published
  - Canvas fallbacks preserve behavior but are not equivalent GPU measurements
draft: false
---

## What runs

The particle study updates position, velocity, age, lifetime, and seed in a ping-pong pair of Storage Buffers. Expired particles respawn deterministically, pointer movement sets the attractor, and a range control changes its strength. Optional timestamp queries resolve separate Compute and Render intervals; unsupported adapters explicitly report that GPU timing is unavailable.

The path-tracing study builds a small Cornell-style scene on the CPU, partitions its triangles with a median BVH, uploads node/triangle/material buffers, and integrates samples through a WebGPU Compute Pass. Alternating linear `rgba16float` textures hold progressive accumulation; the display pass applies tone mapping. Bounce count, Pause, and Reset SPP are wired to the renderer.

## Boundary

The Canvas paths are compatibility previews. Runtime measurements are labeled by source and device capability; the project does not publish a fixed performance promise.
