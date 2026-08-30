---
routeSlug: real-time-rendering-lab
translationKey: real-time-rendering-lab
locale: en
title: Real-Time Rendering Lab
summary: A Three.js WebGL PBR material and lighting bench with a clearly labeled Canvas 2D fallback.
year: 2026
status: in-progress
role: Independent development / rendering engineer
platforms:
  - WebGL2
  - Canvas 2D fallback
technologies:
  - TypeScript
  - Three.js WebGLRenderer
  - MeshStandardMaterial
  - PMREM
heroImage: /media/placeholders/project-real-time-rendering-lab.svg
responsibilities:
  - Builds a repeatable sphere, floor, PMREM room, and moving-light scene
  - Exposes metallic, roughness, exposure, and three implemented debug views
  - Keeps a procedural Canvas 2D fallback when WebGL cannot initialize
featureSlugs:
  - pbr-materials
  - metalness-roughness
  - pmrem-room-environment
  - debug-view-preview
demoSlugs:
  - material-lighting
  - shadow-aa
  - frame-inspector
articleSlugs:
  - rhi-abstraction-boundaries
  - compute-geometry-performance
architecture: Three.js WebGL creates a MeshStandardMaterial, PMREM room environment, moving key light, and orbit camera; a procedural Canvas 2D sphere takes over when WebGL initialization fails.
metrics: []
limitations:
  - The material demo has no WebGPU/TSL path; its debug views are limited to Final, Normal, and Roughness
  - Shadow and anti-aliasing controls belong to a separate Canvas 2D comparison demo, not this WebGL scene
  - Browser results do not represent every desktop GPU or native backend
draft: false
---

## Current implementation

This lab makes material parameters and the color path observable instead of piling on effects. The Three.js WebGL path uses `MeshStandardMaterial`, a PMREM room environment, hemisphere light, moving directional light, and orbit controls. Its controls are Metallic, Roughness, Exposure, and Final, Normal, and Roughness views.

## Fallback and follow-up

When WebGL cannot initialize, the page switches to a clearly labeled procedural Canvas 2D sphere. WebGPU/TSL, real shadow maps, and advanced anti-aliasing are not current backends; the shadow/AA page is an independent Canvas comparison. A real WebGL/GLSL pipeline can be added as a follow-up route.
