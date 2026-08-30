---
routeSlug: material-lighting
translationKey: material-lighting
locale: zh-CN
title: Material & Lighting Lab
summary: 在可重复的校准场景中观察 PBR 材质、直接光照、IBL、曝光和色调映射。
category: rendering
renderer: Three.js WebGLRenderer + PMREM
backend: three-webgl
status: in-progress
featured: true
capabilities:
  - webgl2
requirements:
  - webgpu（优先）
  - webgl2（回退）
controls:
  - Base Color
  - Metalness / Roughness
  - Environment Intensity
  - Exposure / Tone Mapping
  - Debug View
metrics: []
fallbackImage: /media/placeholders/demo-material-lighting.svg
relatedProjects:
  - real-time-rendering-lab
relatedArticles:
  - rhi-abstraction-boundaries
draft: false
---

## 展示目标

用一个简单、稳定的校准物把材质参数和颜色链路讲清楚。最终画面可以切换到 Base Color、Normal、Roughness、Metalness、Direct Lighting 和 Indirect Lighting 等调试视图。

## 交互边界

鼠标或触控只改变相机和显式参数；页面不把渲染结果上传服务器。浏览器优先尝试 WebGPU，初始化失败则进入 WebGL2 回退。性能数据来自当前设备运行时测量，不跨设备比较。
