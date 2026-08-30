---
routeSlug: webgpu-compute-lab
translationKey: webgpu-compute-lab
locale: en
title: WebGPU Compute Lab
summary: WebGPU experiments covering GPU particles, indirect work, and progressive path tracing.
year: 2026
status: idea
role: Independent development / GPU systems engineering
platforms:
  - WebGPU
  - WGSL
technologies:
  - TypeScript
  - WebGPU
  - WGSL
  - Storage Buffer
  - Compute Shader
heroImage: /media/placeholders/project-webgpu-compute-lab.svg
responsibilities:
  - Designed a minimal CPU-to-GPU data path
  - Updated particle state with storage buffers and compute pipelines
  - Recorded frame-time and fallback behavior across quality levels
featureSlugs:
  - storage-buffer
  - ping-pong-buffer
  - compute-dispatch
  - progressive-path-tracing
demoSlugs:
  - gpu-particles
  - path-tracer
articleSlugs:
  - compute-geometry-performance
  - webgpu-particles-path-tracing
architecture: The CPU owns parameters and command organization. A compute pass updates structured buffers, and a render pass consumes the same GPU state; the path-tracing prototype uses an accumulation texture for historical samples.
metrics: []
limitations:
  - Requires a secure context and a browser with WebGPU support
  - The path-tracing scene is intentionally small and is not a production acceleration structure
draft: false
---

## Project outcome

The important WebGPU lesson is not merely drawing a frame. It is understanding how resources are declared, commands are submitted, and CPU/GPU work stays independent without unnecessary round trips. The lab pairs a continuously updated compute workload with a progressive path tracer that exposes accumulation and reset rules.

## GPU particle path

Particle state lives in storage buffers. Each frame a compute shader reads position, velocity, and lifetime from one buffer and writes the next. Ping-pong buffers avoid reading and writing the same state in one dispatch; the render pass consumes the current buffer and expands particles into points or small quads.

```text
parameters → command encoder
           → compute(pass: state[n] → state[n+1])
           → render(pass: state[n+1] → canvas)
```

Changing the particle count changes buffer size and dispatch workgroup count. Quality levels keep defaults reasonable on mobile. The panel reports compute time separately from total frame time so browser composition is not mistaken for shader work.

## Progressive path tracing

The prototype builds a small BVH on the CPU while the GPU generates batches of samples into an accumulation texture. Camera, material, or resolution changes clear the accumulation; otherwise old and new projections are incorrectly combined. A four-bounce limit keeps interaction practical and is not a quality claim.

## Resources and synchronization

Every buffer has a visible purpose, size, and usage stage. The command encoder records work only after those declarations are known. WebGPU hides many low-level barrier details, but it does not remove the need to reason about usage and lifetime. Device loss reports a state and releases the controller so the page can fall back to a recording.

## Current boundary

Browser WebGPU support and driver behavior vary. The path tracer does not include production light sampling, compressed BVHs, or denoising; the neural graphics lab will later reuse its low/high-sample image pairs.
