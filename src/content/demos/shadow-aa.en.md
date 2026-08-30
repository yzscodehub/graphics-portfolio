---
routeSlug: shadow-aa
translationKey: shadow-aa
locale: en
title: Shadow & Anti-Aliasing Lab
summary: Compare shared raw-WebGPU shadow, G-Buffer, depth, velocity, and temporal-history paths with a Canvas fallback.
category: rendering
renderer: Raw WebGPU reference frame / Canvas 2D fallback
backend: raw-webgpu
status: completed
maturity: completed
evidence: verified
backends:
  - id: raw-webgpu
    label: Shared raw WebGPU reference frame
    role: primary
    capabilities:
      - webgpu
  - id: canvas-2d
    label: Labeled Canvas 2D comparison
    role: fallback
    capabilities: []
capabilities:
  - webgpu
requirements:
  - label: WebGPU
    required: false
    capability: webgpu
  - label: Canvas 2D fallback
    required: false
fallback:
  kind: canvas-2d
  description: A labeled Canvas comparison keeps shadow softness and history controls usable when the raw reference frame cannot initialize.
  image: /media/demos/shadow-aa-poster.svg
controls:
  - SHADOW HARD
  - SHADOW PCF
  - SHADOW PCSS
  - AA NONE
  - AA FXAA
  - AA TAA
  - RESET HISTORY
metrics: []
metricSource:
  kind: runtime
  description: The live renderer reports backend and selected mode; no fixed cross-device GPU performance number is published.
fallbackImage: /media/demos/shadow-aa-poster.svg
relatedProjects:
  - real-time-rendering-lab
relatedArticles:
  - rhi-abstraction-boundaries
draft: false
---

## What runs

The raw WebGPU reference frame encodes a shadow map, a multi-target G-Buffer, linear depth, velocity, HDR lighting, SSAO, and temporal resolve history in one shared frame. Hard, PCF, and PCSS shadow modes select the implemented shader branches; None, FXAA, and TAA select the corresponding resolve path.

## Temporal behavior

TAA uses jitter and previous-frame depth/velocity state. Changing the shadow mode, AA mode, scene revision, or explicit Reset History invalidates the accumulated history. Freeze is available through the Frame Inspector, which can display the same attachment family without advancing the frame.

## Fallback boundary

When WebGPU cannot initialize or the device is lost, the page switches to a clearly labeled Canvas comparison. The fallback preserves the mode vocabulary and reset behavior but is not a substitute for the raw G-Buffer implementation.
