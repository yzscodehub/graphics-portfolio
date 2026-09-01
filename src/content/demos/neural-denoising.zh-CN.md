---
routeSlug: neural-denoising
translationKey: neural-denoising
locale: zh-CN
title: Neural Denoising
summary: 通过显式点击对经哈希校验的留出配对执行 ONNX 推理，并在 WebGPU/WASM 间选择后端，保留确定性回退。
category: machine-learning
renderer: ONNX Runtime WebGPU/WASM + 确定性 Canvas probe
backend: onnx-web
status: in-progress
maturity: in-progress
evidence: measured
backends:
  - id: onnx-web
    label: ONNX Runtime WebGPU 或单线程 WASM
    role: primary
    capabilities:
      - webgpu
      - wasm
  - id: canvas-2d
    label: 确定性程序化回退
    role: fallback
    capabilities: []
capabilities:
  - webgpu
  - wasm
requirements:
  - label: 经审核的 ONNX 模型与哈希校验留出 manifest
    required: false
  - label: WebGPU 执行后端（可选）
    required: false
    capability: webgpu
  - label: 单线程 WASM 回退
    required: false
    capability: wasm
fallback:
  kind: canvas-2d
  description: 审核运行前后均保留确定性程序化 Canvas probe，不自动下载模型数据。
  image: /media/demos/neural-denoising-poster.svg
controls:
  - NOISY
  - DENOISED
  - REFERENCE
  - ERROR
  - RUN REVIEWED MODEL
  - SHOW GUIDED CANDIDATE
metrics:
  - label: 验证集 L1 降幅
    value: 38.9%
    status: confirmed
    source: public/models/neural-denoiser.metrics.json / 独立留出离线验证
  - label: 验证集 PSNR 提升
    value: +5.46 dB
    status: confirmed
    source: public/models/neural-denoiser.metrics.json / 独立留出离线验证
  - label: 推理 P50
    value: runtime
    status: measured
    source: 点击 RUN REVIEWED MODEL 后的浏览器运行
  - label: 推理 P95
    value: runtime
    status: measured
    source: 点击 RUN REVIEWED MODEL 后的浏览器运行
metricSource:
  kind: offline-validation
  description: 确认的 L1/PSNR 来自独立留出配对与离线验证记录；P50/P95 仅在浏览器显式运行后测量，并随设备/后端变化。
currentLimit: Guided 仍是未审核的静态 candidate，没有 ONNX 质量声明；只有已审核 RGB 模型属于 completed 部分。
fallbackImage: /media/demos/neural-denoising-poster.svg
relatedProjects:
  - neural-graphics-lab
relatedArticles:
  - path-tracing-to-neural-denoising
assetIds:
  - neural-heldout-v2
modes:
  - rgb
  - guided
sourceUrl: https://github.com/yzscodehub/graphics-portfolio/blob/main/src/demos/neural-denoising.ts
draft: false
---

## 实际运行内容

页面初始显示确定性的程序化 probe，不会静默下载模型数据。点击 `RUN REVIEWED MODEL` 后，页面获取版本化留出 manifest 和配对浮点资源，校验字节长度与 SHA-256，然后优先选择 ONNX Runtime WebGPU，不可用时使用单线程 WASM。

## 模型状态

RGB 模型已完成审核，是本 Demo 中标为 completed 的部分；页面所列 L1 与
PSNR 仅属于该已审核 RGB 模型。

Guided 是经哈希绑定的静态 candidate，不是已审核 ONNX 模型，也没有发布
质量提升声明。只有同一验证划分上的已审核模型同时改善 L1 与 PSNR 后，才可
解除 Release 门禁。

## 证据与指标

审核运行会针对哈希校验的留出参考配对计算 L1 和 PSNR，并在预热后报告推理 P50/P95。静态 L1/PSNR 提升来自独立离线验证记录；浏览器 probe 不是那组验证帧，不能用来复现这些数值。

## 回退边界

模型加载、manifest 校验、形状校验、执行后端初始化或推理失败时，确定性 Canvas probe 仍然可见。页面同时标注后端和指标来源，避免把运行时耗时与离线质量证据混为一谈。
