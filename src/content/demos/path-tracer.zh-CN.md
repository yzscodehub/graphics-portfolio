---
routeSlug: path-tracer
translationKey: path-tracer
locale: zh-CN
title: Progressive Path Study
summary: 使用原生 WebGPU 研究小型全屏渐进式路径近似图像，并在 WebGPU 不可用时使用 Canvas 回退。
category: gpu
renderer: Raw WebGPU + WGSL / Canvas 2D 回退
backend: raw-webgpu
status: idea
featured: false
capabilities:
  - webgpu
requirements:
  - 优先使用 WebGPU
  - WebGPU 不可用时使用 Canvas 2D 回退
controls:
  - 2 BOUNCES
  - 3 BOUNCES
  - 4 BOUNCES
metrics: []
fallbackImage: /media/placeholders/demo-path-tracer.svg
relatedProjects:
  - webgpu-compute-lab
relatedArticles:
  - webgpu-particles-path-tracing
draft: false
---

## 展示内容

WebGPU 片元着色器绘制一个全屏程序化房间，包含解析地面和两个球体，再把带抖动的路径近似结果混合到两个颜色纹理中。唯一暴露的控件是最大反弹次数；当前没有 CPU 构建 BVH、材质选择、Samples Per Pixel 或显式重置按钮。

## 明确限制

这是着色器资源和渐进式累积的视觉研究，不是生产级路径追踪器。回退路径是程序化 Canvas 2D 场景，报告的是视觉样本而非 GPU 计时。生产级光源采样、BVH、材质变体、显式重置和去噪保留为后续路线。
