---
routeSlug: gpu-particles
translationKey: gpu-particles
locale: en
title: GPU-Driven Visibility & Compute
summary: Compare a ping-pong particle simulation with GPU-driven instance visibility, LOD selection, compaction, and indirect-draw evidence on one raw-WebGPU data path.
category: gpu
renderer: Raw WebGPU + WGSL / Canvas 2D fallback
backend: raw-webgpu
status: in-progress
maturity: in-progress
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
  description: A labeled Canvas path reruns deterministic CPU frustum/LOD culling and shows a sampled visibility heatmap when WebGPU is unavailable.
  image: /media/demos/gpu-particles-poster.svg
controls:
  - MODE SIMULATION
  - MODE VISIBILITY
  - 25K particles
  - 100K particles
  - 250K particles
  - 10K / 50K / 100K instances
  - CPU BASELINE / RAW WEBGPU
  - CAMERA SWEEP
  - Attractor range
  - Pointer attractor
  - Pause / Resume
  - Reset
metrics: []
metricSource:
  kind: runtime
  description: When timestamp-query is supported, compute and render durations are read back from GPU timestamps; otherwise the panel reports animation-frame status without a GPU-time claim.
currentLimit: GPU time is available only with timestamp-query; CPU and Canvas cadence is not comparable, while Hi-Z, meshlets, and occlusion culling remain out of scope.
fallbackImage: /media/demos/gpu-particles-poster.svg
relatedProjects:
  - webgpu-compute-lab
relatedArticles:
  - compute-geometry-performance
  - webgpu-particles-path-tracing
  - gpu-driven-visibility-indirect
assetIds:
  - visibility-instance-field
modes:
  - simulation
  - visibility
referenceScene: visibility-instance-field
sourceUrl: https://github.com/yzscodehub/graphics-portfolio/blob/main/src/demos/gpu-particles.ts
draft: false
---

## What runs

Simulation keeps two particle buffers and alternates their read/write roles each frame. Visibility uses a separate deterministic instance field: Compute frustum culling selects an LOD, atomically compacts it into one of three fixed segments, writes three 32-byte indexed-indirect commands, and issues three `drawIndexedIndirect` calls against distinct index ranges. `firstInstance` remains zero for every command.

## Interaction and measurement

Simulation count buttons rebuild 25K, 100K, or 250K particles. Visibility selects 10K, 50K, or 100K instances and exposes CPU Baseline, Raw WebGPU, Camera Sweep, Pause, and Reset. The CPU baseline reruns the same frustum/LOD reference every frame and reports CPU culling time. The GPU path performs low-frequency readback of all three commands plus tested, visible, and LOD counters. If the adapter exposes `timestamp-query`, Compute and Render intervals are reported separately; otherwise timing is explicitly unavailable.

## Fallback boundary

The Canvas fallback reruns the same deterministic visibility reference but only draws a sampled heatmap. On the first `device.lost`, the controller disposes the old renderer and attempts one generation-guarded rebuild with the current mode, count, and camera-sweep state; a failed rebuild or second loss falls back to Canvas. Its CPU/animation-frame cadence must not be compared directly with native GPU timestamps. This Demo remains in progress until real-WebGPU three-command readback and performance acceptance are captured on the declared hardware.
