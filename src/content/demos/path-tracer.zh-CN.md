---
routeSlug: path-tracer
translationKey: path-tracer
locale: zh-CN
title: Progressive Path Tracer
summary: 使用 CPU median BVH、三角形/材质 Buffer、线性 rgba16float 累积与独立色调映射追踪程序化 Cornell 场景。
category: gpu
renderer: Raw WebGPU Compute + Display / Canvas 2D 回退
backend: raw-webgpu
status: in-progress
maturity: in-progress
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
currentLimit: Canvas 路径只是视觉近似且样本不代表 GPU 测量；MIS、ReSTIR 与超过四次反弹仍不在本轮范围。
fallbackImage: /media/demos/path-tracer-poster.svg
relatedProjects:
  - webgpu-compute-lab
relatedArticles:
  - webgpu-particles-path-tracing
  - bvh-progressive-path-tracing
assetIds:
  - cornell-scene
modes:
  - progressive
referenceScene: cornell
sourceUrl: https://github.com/yzscodehub/graphics-portfolio/blob/main/src/demos/path-tracer.ts
draft: false
---

## 实际运行内容

CPU 构建小型 Cornell 风格场景，对三角形执行 median split 生成 BVH，并上传编码后的三角形、节点和材质 Buffer。WebGPU Compute Pass 追踪场景，将线性 HDR 样本写入交替的 `rgba16float` Storage Texture；Display Pass 独立执行色调映射。

## 控件与累积

四个反弹按钮更新 uniform 契约并重置样本计数。Pause 保留当前累积而不增加样本；Reset SPP 清空累积状态并推进相机版本。面板展示 SPP 和反弹次数，不把它们包装成通用画质或速度承诺。

## 收敛与遍历证据

证据面板记录 1、2、4、8、16、32、64 SPP 的低频 direct-light 实测 MSE。
自制参考由 16 条固定采样序列各自的 4096 个样本构成，并在源码中使用
SHA-256 绑定。它不是完整图像误差，也不是 GPU 性能指标；其作用是用可复现
的实际估计器误差替代把 1/sqrt(SPP) 当作实测质量的说法。

WebGPU 路径同时展示有界 BVH 栈的累计 overflow 计数。当前 Cornell 场景预期为
零；非零表示遍历无法压入 child-pair，样本不能再被视为完整证据。

## 回退边界

CPU Canvas 路径明确标注为视觉近似，保留交互契约，但样本和帧节奏不代表 GPU 测量。

当前 Generation 首次发生 Device Loss 时会尝试重建一次，保留反弹次数和暂停状态，但将累积重置为 0 SPP；重建失败或第二次 Loss 才进入 Canvas 回退。
