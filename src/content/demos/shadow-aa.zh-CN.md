---
routeSlug: shadow-aa
translationKey: shadow-aa
locale: zh-CN
title: Shadow & Anti-Aliasing Lab
summary: 在程序化 Canvas 2D 场景中比较带标签的阴影柔化和边缘处理模式。
category: rendering
renderer: Canvas 2D 技术可视化
backend: canvas-2d
status: in-progress
featured: false
capabilities: []
requirements:
  - 基础 Canvas 2D
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

## 展示内容

这个 Demo 使用 Canvas 2D 绘制、模糊和短暂历史轨迹来做带标签的视觉对比。Hard、PCF、PCSS 表示逐渐增强的柔化效果，None、FXAA、TAA 表示边缘处理方式；它们不是 WebGL 阴影贴图、GLSL 滤波器或真实时间抗锯齿 resolve 的实现。

## 后续路线

实现真实深度图、过滤核、速度 Buffer 和历史有效性后，可以沿用这些控件接入真正的 WebGL/GLSL 阴影与抗锯齿对比。
