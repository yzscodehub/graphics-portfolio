---
routeSlug: shadow-aa
translationKey: shadow-aa
locale: en
title: Shadow & Anti-Aliasing Lab
summary: Compare shared raw-WebGPU shadow, G-Buffer, depth, velocity, temporal history, and the live Temporal Resolve reject mask with a Canvas fallback.
category: rendering
renderer: Raw WebGPU reference frame / Canvas 2D fallback
backend: raw-webgpu
status: in-progress
maturity: in-progress
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
  - VIEW FINAL
  - VIEW REJECT MASK
  - RESET HISTORY
metrics: []
metricSource:
  kind: runtime
  description: The live renderer reports backend and selected mode; no fixed cross-device GPU performance number is published.
currentLimit: The live path currently uses the self-authored analytical Reference Frame rather than the packed Research Courtyard; the Canvas reject view is illustrative rather than a captured GPU attachment.
fallbackImage: /media/demos/shadow-aa-poster.svg
relatedProjects:
  - real-time-rendering-lab
relatedArticles:
  - shadow-temporal-aa
  - frame-inspector-observability
assetIds:
  - reference-frame-procedural
modes:
  - shadow
  - temporal
referenceScene: reference-frame-procedural
sourceUrl: https://github.com/yzscodehub/graphics-portfolio/blob/main/src/demos/shadow-aa.ts
draft: false
---

## What runs

The raw WebGPU reference frame encodes a shadow map, a multi-target G-Buffer, linear depth, velocity, HDR lighting, SSAO, temporal resolve history, and an r8 History Reject Mask in one shared frame. Hard, PCF, and PCSS shadow modes select the implemented shader branches; None, FXAA, and TAA select the corresponding resolve path.

## Temporal behavior

TAA uses UV velocity projected from current/previous world points, Halton jitter, and previous-frame depth. Reprojected coordinates are bounds-rejected before clamping, then pass depth rejection and neighborhood clamping. VIEW REJECT MASK displays the actual Temporal Resolve attachment: white means no usable history, UV-bounds rejection, or depth rejection; black means accepted history. Changing the shadow mode, AA mode, scene revision, explicit Reset History, or resuming after a page pause invalidates the accumulated history. Freeze is available through the Frame Inspector, which can display the same attachment family without advancing the frame.

## Fallback boundary

When WebGPU cannot initialize or the device is lost, the page switches to a clearly labeled Canvas comparison. Its reject view is an illustration, not a captured GPU reject attachment; the fallback preserves mode vocabulary and reset behavior but is not a substitute for the raw G-Buffer implementation.
On the first device loss, the controller first attempts one generation-guarded Reference Frame rebuild; initialization failure or a second loss enters the Canvas comparison.
