---
routeSlug: webgpu-compute-lab
translationKey: webgpu-compute-lab
locale: en
title: WebGPU Compute Lab
summary: WebGPU experiments for GPU particles and a full-screen progressive path study; advanced acceleration remains a follow-up route.
year: 2026
status: idea
role: Independent development / GPU systems engineering
platforms:
  - WebGPU
  - Canvas 2D fallback
technologies:
  - TypeScript
  - WebGPU
  - WGSL
  - Storage Buffer
  - Compute Shader
heroImage: /media/placeholders/project-webgpu-compute-lab.svg
responsibilities:
  - Updates a single read_write storage buffer from a native Compute Pass
  - Draws the same GPU particle buffer with a native Render Pass
  - Keeps labeled Canvas previews when WebGPU is unavailable
featureSlugs:
  - read-write-storage-buffer
  - compute-dispatch
  - progressive-accumulation
  - canvas-fallback
demoSlugs:
  - gpu-particles
  - path-tracer
articleSlugs:
  - compute-geometry-performance
  - webgpu-particles-path-tracing
architecture: The CPU owns parameters and command organization. A compute pass updates one read_write storage buffer before a render pass draws it; the path study keeps progressive history in two color textures.
metrics: []
limitations:
  - Particles currently have no ping-pong buffers, independent GPU timer, attractor/noise controls, or indirect drawing
  - The path study has no CPU BVH, material selector, Samples Per Pixel control, or explicit reset control; it exposes only 2/3/4 bounce buttons
  - Requires a secure context and WebGPU support; unsupported environments use a clearly labeled Canvas preview
draft: false
---

## Current implementation

The particle experiment stores state in one `read_write` storage buffer. A Compute Pass updates it in place, then a Render Pass draws the same buffer as points. The page exposes 25K, 100K, and 250K count buttons and reports backend and particle count, but no independent GPU timer.

The path study uses a WGSL fragment shader to draw a procedural room, floor, and two spheres, then stores progressive results in two color textures. It exposes maximum bounce buttons for 2, 3, and 4; it has no CPU BVH, material selector, Samples Per Pixel control, or explicit reset control. Ping-pong state, indirect drawing, production acceleration structures, and denoising remain follow-up work.
