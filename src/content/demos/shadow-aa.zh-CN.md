---
routeSlug: shadow-aa
translationKey: shadow-aa
locale: zh-CN
title: Shadow & Anti-Aliasing Lab
summary: 在同一场景中比较阴影过滤和抗锯齿策略的边缘质量、稳定性与运行时成本。
category: rendering
renderer: Canvas 2D 技术可视化
backend: canvas-2d
status: in-progress
featured: false
capabilities: []
requirements:
  - webgl2
controls:
  - Hard / PCF / PCSS
  - No AA / FXAA / TAA
  - Shadow Bias
  - Filter Radius
  - Camera Motion
metrics: []
fallbackImage: /media/placeholders/demo-shadow-aa.svg
relatedProjects:
  - real-time-rendering-lab
relatedArticles:
  - rhi-abstraction-boundaries
draft: false
---

## 展示目标

硬阴影、PCF 和 PCSS 使用相同光源与接收面，方便观察采样与半影假设。抗锯齿选项聚焦几何边缘和相机运动中的稳定性；TAA 需要历史有效性和速度信息，不能只把当前帧模糊后称为时间抗锯齿。

## 兼容性

该 Demo 保留传统 WebGLRenderer 与 GLSL 路径，以便比较旧有着色器和新 WebGPU 路径。高级过滤不可用时展示静态对比图。
