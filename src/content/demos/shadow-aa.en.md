---
routeSlug: shadow-aa
translationKey: shadow-aa
locale: en
title: Shadow & Anti-Aliasing Lab
summary: Compare labeled shadow-softness and edge-treatment modes in a procedural Canvas 2D scene.
category: rendering
renderer: Canvas 2D technique visualizer
backend: canvas-2d
status: in-progress
featured: false
capabilities: []
requirements:
  - Baseline Canvas 2D
controls:
  - SHADOW HARD
  - SHADOW PCF
  - SHADOW PCSS
  - AA NONE
  - AA FXAA
  - AA TAA
metrics: []
fallbackImage: /media/placeholders/demo-shadow-aa.svg
relatedProjects:
  - real-time-rendering-lab
relatedArticles:
  - rhi-abstraction-boundaries
draft: false
---

## What it demonstrates

This demo uses Canvas 2D drawing, blur, and a small history trail to make labeled modes comparable. Hard, PCF, and PCSS describe increasing softness in the visual probe; None, FXAA, and TAA describe edge treatments. They are not implementations of WebGL shadow maps, GLSL filters, or a real temporal resolve.

## Follow-up route

A true WebGL/GLSL shadow and anti-aliasing comparison can reuse these controls after a real depth map, filtering kernel, velocity buffer, and history validation path are implemented.
