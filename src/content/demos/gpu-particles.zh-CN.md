---
routeSlug: gpu-particles
translationKey: gpu-particles
locale: zh-CN
title: GPU Compute Particles
summary: 使用原生 WebGPU 和 WGSL 原地更新单个粒子 Storage Buffer，并提供明确标注的 Canvas 回退。
category: gpu
renderer: Raw WebGPU + WGSL / Canvas 2D 回退
backend: raw-webgpu
status: idea
featured: true
capabilities:
  - webgpu
requirements:
  - 优先使用 WebGPU
  - WebGPU 不可用时使用 Canvas 2D 回退
controls:
  - 25K particles
  - 100K particles
  - 250K particles
metrics: []
fallbackImage: /media/placeholders/demo-gpu-particles.svg
relatedProjects:
  - webgpu-compute-lab
relatedArticles:
  - compute-geometry-performance
  - webgpu-particles-path-tracing
draft: false
---

## 展示内容

粒子状态存放在一个 `read_write` Storage Buffer 中。Compute Pass 原地更新它，随后 Render Pass 将同一份 Buffer 绘制为点。当前实现报告后端和粒子数量，不提供独立 GPU 计时，也不拆分 Compute 与总帧时间。

## 回退行为

WebGPU 不可用时，页面创建缩减后的 Canvas 2D 预览并明确标记。三个数量按钮会按所选规模重新创建渲染器。Ping-Pong 状态、间接绘制、吸引子/噪声控件和独立 GPU 计时属于后续路线。
