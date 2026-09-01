---
routeSlug: gpu-particles
translationKey: gpu-particles
locale: zh-CN
title: GPU-Driven Visibility & Compute
summary: 在同一原生 WebGPU 数据路径中比较 Ping-Pong 粒子模拟与实例可见性、LOD、Compaction 和 Indirect Draw 证据。
category: gpu
renderer: Raw WebGPU + WGSL / Canvas 2D 回退
backend: raw-webgpu
status: in-progress
maturity: in-progress
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
  - 10K / 50K / 100K instances
  - CPU BASELINE / RAW WEBGPU
  - CAMERA SWEEP
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
  - visibility-instance-field
modes:
  - simulation
  - visibility
referenceScene: visibility-instance-field
sourceUrl: https://github.com/yzscodehub/graphics-portfolio/blob/main/src/demos/gpu-particles.ts
draft: false
---

> Visibility 模式使用 10K / 50K / 100K 的确定性实例场：CPU Baseline 每帧重新执行相同的视锥裁剪和三档 LOD 切分；WebGPU 路径将三档结果压缩到三个独立 segment，写入三条 32-byte aligned indexed indirect command，并执行三次 `drawIndexedIndirect`。`CAMERA SWEEP` 用于观察可见集和 LOD 分布变化，低频 readback 校验 Tested、Visible、三档 LOD Count 与三条 command。该 Demo 在真实 WebGPU 三 command readback 与性能验收完成前保持 in-progress。

## 实际运行内容

Simulation 维护两个粒子 Buffer，每帧交替读写。Visibility 使用独立的确定性实例场：Compute 先做视锥裁剪和三档 LOD 选择，再把结果原子压缩到三个固定 Segment，写入三条 32-byte Indexed Indirect Command，并针对不同 Index Range 执行三次 `drawIndexedIndirect`。所有 Command 的 `firstInstance` 均固定为 0。

## 交互与测量

Simulation 数量按钮会重建 25K、100K 或 250K 粒子。Visibility 可选择 10K、50K 或 100K 实例，并提供 CPU Baseline、Raw WebGPU、Camera Sweep、Pause 和 Reset。CPU Baseline 每帧重新执行同一套 Culling/LOD 参考并报告 CPU 时间；GPU 路径低频读回三条 Command、Tested、Visible 与三档 LOD Count。只有支持 `timestamp-query` 时才分别报告 Compute/Render GPU 时间。

## 回退边界

Canvas 回退会重新运行相同的确定性 Visibility 参考，但只绘制抽样 Heatmap。首次 `device.lost` 时，控制器释放旧 Renderer，并按当前模式、数量和 Camera Sweep 状态尝试一次受 Generation Guard 保护的重建；重建失败或第二次 Loss 才进入 Canvas。CPU/Animation Frame 节奏不能与原生 GPU Timestamp 直接比较；真实 WebGPU 三 Command Readback 与性能验收完成前，本 Demo 保持 in-progress。
