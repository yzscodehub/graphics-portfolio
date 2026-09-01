---
routeSlug: gpu-particles
translationKey: gpu-particles
locale: zh-CN
title: GPU-Driven Visibility & Compute
summary: 在同一原生 WebGPU 数据路径中比较 Ping-Pong 粒子模拟与实例可见性、LOD、Compaction 和 Indirect Draw 证据。
category: gpu
renderer: Raw WebGPU + WGSL / Canvas 2D 回退
backend: raw-webgpu
status: completed
maturity: completed
evidence: measured
backends:
  - id: raw-webgpu
    label: 原生 WebGPU Compute 与 Render Pass
    role: primary
    capabilities:
      - webgpu
  - id: canvas-2d
    label: 缩减的确定性 Canvas 2D 预览
    role: fallback
    capabilities: []
capabilities:
  - webgpu
requirements:
  - label: WebGPU
    required: false
    capability: webgpu
  - label: timestamp-query 特性（可选）
    required: false
    capability: webgpu
fallback:
  kind: canvas-2d
  description: WebGPU 不可用时使用缩减的 Canvas 2D 生命周期预览，并保留控件和明确标签。
  image: /media/demos/gpu-particles-poster.svg
controls:
  - MODE SIMULATION
  - MODE VISIBILITY
  - 25K particles
  - 100K particles
  - 250K particles
  - Attractor 范围
  - Pointer attractor
  - Pause / Resume
  - Reset
metrics: []
metricSource:
  kind: runtime
  description: 支持 timestamp-query 时从 GPU 时间戳读取 Compute/Render 区间，否则仅报告 animation-frame 状态，不声称 GPU 时间。
currentLimit: 只有 timestamp-query 可用时才报告 GPU 时间；CPU 与 Canvas 帧节奏不可直接比较，Hi-Z、Meshlet 与遮挡剔除不在本轮范围。
fallbackImage: /media/demos/gpu-particles-poster.svg
relatedProjects:
  - webgpu-compute-lab
relatedArticles:
  - compute-geometry-performance
  - webgpu-particles-path-tracing
  - gpu-driven-visibility-indirect
assetIds:
  - research-courtyard
modes:
  - simulation
  - visibility
referenceScene: research-courtyard
sourceUrl: https://github.com/yzscodehub/graphics-portfolio/blob/main/src/demos/gpu-particles.ts
draft: false
---

## 实际运行内容

WebGPU 路径维护两个粒子 Buffer，每帧交替读写。Compute Pass 更新位置、速度、年龄、生命周期和种子；过期或越界粒子会以确定性方式重生。Render Pass 消费写入的 Buffer，点的颜色和透明度反映剩余生命周期。

## 交互与测量

数量按钮会为 25K、100K 或 250K 粒子重新创建资源。指针控制吸引子，范围控件调整吸引力，Pause/Reset 同时作用于原生和 Canvas 实现。适配器支持 `timestamp-query` 时，Demo 解析独立 Compute/Render 区间并标记 `gpu-timestamp-query`；否则明确显示计时不可用。

## 回退边界

Canvas 回退以缩减规模实现相同的生命周期和吸引子概念，但 animation-frame 节奏不能与原生 GPU 时间戳直接比较。
