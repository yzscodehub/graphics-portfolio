---
routeSlug: path-tracer
translationKey: path-tracer
locale: zh-CN
title: Progressive Path Tracer
summary: 使用 CPU median BVH、三角形/材质 Buffer、线性 rgba16float 累积与独立色调映射追踪程序化 Cornell 场景。
category: gpu
renderer: Raw WebGPU Compute + Display / Canvas 2D 回退
backend: raw-webgpu
status: completed
maturity: completed
evidence: verified
backends:
  - id: raw-webgpu
    label: 原生 WebGPU Compute 路径追踪器
    role: primary
    capabilities:
      - webgpu
  - id: canvas-2d
    label: CPU path-like Canvas 2D 回退
    role: fallback
    capabilities: []
capabilities:
  - webgpu
requirements:
  - label: WebGPU
    required: false
    capability: webgpu
  - label: rgba16float storage textures
    required: false
    capability: webgpu
fallback:
  kind: canvas-2d
  description: WebGPU 不可用时，使用带标签的 CPU path-like Canvas 预览保留反弹、暂停、重置和样本状态。
  image: /media/demos/path-tracer-poster.svg
controls:
  - 1 BOUNCE
  - 2 BOUNCES
  - 3 BOUNCES
  - 4 BOUNCES
  - Pause / Resume
  - Reset SPP
metrics: []
metricSource:
  kind: runtime
  description: 面板报告累计 SPP 和 animation-frame 状态，不发布固定 GPU 耗时数字。
fallbackImage: /media/demos/path-tracer-poster.svg
relatedProjects:
  - webgpu-compute-lab
relatedArticles:
  - webgpu-particles-path-tracing
  - bvh-progressive-path-tracing
  - path-tracing-to-neural-denoising
draft: false
---

## 实际运行内容

CPU 构建小型 Cornell 风格场景，对三角形执行 median split 生成 BVH，并上传编码后的三角形、节点和材质 Buffer。WebGPU Compute Pass 追踪场景，将线性 HDR 样本写入交替的 `rgba16float` Storage Texture；Display Pass 独立执行色调映射。

## 控件与累积

四个反弹按钮更新 uniform 契约并重置样本计数。Pause 保留当前累积而不增加样本；Reset SPP 清空累积状态并推进相机版本。面板展示 SPP 和反弹次数，不把它们包装成通用画质或速度承诺。

## 回退边界

CPU Canvas 路径明确标注为视觉近似，保留交互契约，但样本和帧节奏不代表 GPU 测量。
