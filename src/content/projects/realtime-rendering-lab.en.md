---
routeSlug: real-time-rendering-lab
translationKey: real-time-rendering-lab
locale: en
title: Real-Time Rendering Lab
summary: A tunable rendering bench for PBR, IBL, shadows, anti-aliasing, and post-processing experiments.
year: 2026
status: in-progress
role: Independent development / rendering engineer
platforms:
  - WebGL2
  - WebGPU (experimental)
technologies:
  - TypeScript
  - Three.js
  - GLSL
  - TSL
  - PBR
heroImage: /media/placeholders/project-real-time-rendering-lab.svg
responsibilities:
  - Built repeatable material and lighting comparison scenes
  - Recorded intermediate views from inputs to final color
  - Compared shadow and anti-aliasing strategies for quality and cost
featureSlugs:
  - pbr-materials
  - image-based-lighting
  - shadow-filtering
  - anti-aliasing
demoSlugs:
  - material-lighting
  - shadow-aa
  - frame-inspector
articleSlugs:
  - rhi-abstraction-boundaries
  - compute-geometry-performance
architecture: Scene, material, lighting, and post-processing are separate experiment modules coordinated by a demo shell that owns size, pause, quality, and fallback behavior.
metrics: []
limitations:
  - Browser results do not represent every desktop GPU or native backend
  - TAA and advanced shadow modes may degrade to a static comparison by environment
draft: false
---

## Project outcome

The lab is not a pile of visual effects. Each effect should answer what the input is, where it enters the pipeline, which error it changes, and what it costs. Adjust material, environment light, and debug views on one calibration scene, then compare shadow and anti-aliasing behavior on the same data.

## Scene and color pipeline

The calibration object uses simple, repeatable geometry and materials so lighting differences remain visible. Material parameters participate in lighting in an approximately linear space, and the final HDR signal passes through exposure, tone mapping, and display conversion. Debug views stop at intermediate stages to separate normal, roughness, and color-management errors.

```text
material inputs → direct / image-based lighting → HDR buffer
                → post process → exposure / tone map → display color
```

“Physical” here means a common real-time PBR approximation with explicit parameter and energy relationships; it is not a claim of a full offline renderer. IBL uses a prefiltered environment approximation for specular response, with broader mip selection as roughness increases.

## Shadows and anti-aliasing

The shadow experiment keeps the light and receiver fixed while changing sampling, filtering radius, and bias. Hard shadows expose the depth comparison, PCF reduces edge aliasing at a sampling cost, and PCSS introduces a blocker-to-receiver distance for a penumbra estimate. The anti-aliasing experiment keeps geometric edges and camera motion visible; TAA needs velocity and history validity or it will ghost during movement.

## Observability

Every view carries an explicit hypothesis. Normal checks orientation and tangent-space conventions, Depth keeps nonlinear depth visible, and Lighting isolates direct and indirect contributions. The metrics panel reports the current device's measured frame time rather than mixing results from unrelated hardware.

## Current boundary

WebGL2 is the reliable fallback while WebGPU/TSL serves new paths. Their precision, drivers, and post-processing capabilities are not identical, so every advanced effect needs a static image or recording fallback.
