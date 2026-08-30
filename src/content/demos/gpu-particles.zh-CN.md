---
routeSlug: gpu-particles
translationKey: gpu-particles
locale: zh-CN
title: GPU Compute Particles
summary: 用原生 WebGPU 和 WGSL 在 GPU 上更新粒子状态，观察 Buffer、Dispatch 与帧时间的关系。
category: gpu
renderer: Raw WebGPU + WGSL
backend: raw-webgpu
status: idea
featured: true
capabilities:
  - webgpu
requirements:
  - webgpu
controls:
  - "Particle Count: 25K / 100K / 250K"
  - Attractor Strength
  - Noise Field
  - Quality Level
  - Pause / Reset
metrics: []
fallbackImage: /media/placeholders/demo-gpu-particles.svg
relatedProjects:
  - webgpu-compute-lab
relatedArticles:
  - compute-geometry-performance
  - webgpu-particles-path-tracing
draft: false
---

## 展示目标

粒子状态保存在 Storage Buffer 中，由 Compute Shader 读写 Ping-Pong Buffer，再由 Render Pass 绘制。控制台会分开显示 Compute 与总帧时间，帮助区分着色器工作和浏览器合成。

## 回退行为

WebGPU 不可用时显示录制视频和相同参数说明。移动端默认较低粒子数；页面离开视口或进入后台时停止 Dispatch 和动画。
