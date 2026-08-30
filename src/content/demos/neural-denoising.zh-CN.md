---
routeSlug: neural-denoising
translationKey: neural-denoising
locale: zh-CN
title: Neural Denoising
summary: 对比确定性程序化 noisy/reference probe 与可选的经审核 ONNX 输出。
category: machine-learning
renderer: Canvas 2D 确定性 probe + 可选 ONNX Runtime Web
backend: onnx-web
status: completed
featured: true
capabilities:
  - webgpu
  - wasm
requirements:
  - 始终可用的 Canvas 2D probe
  - 可选的经审核 ONNX 模型文件
controls:
  - NOISY
  - DENOISED
  - REFERENCE
  - ERROR
metrics:
  - label: 验证集 L1 降幅
    value: 38.9%
    status: confirmed
  - label: 验证集 PSNR 提升
    value: +5.46 dB
    status: confirmed
metricSource: 已确认数值来自独立的留出离线验证运行，不来自当前浏览器程序化 probe。
fallbackImage: /media/placeholders/demo-neural-denoising.svg
relatedProjects:
  - neural-graphics-lab
relatedArticles:
  - path-tracing-to-neural-denoising
draft: false
---

## 实际运行内容

浏览器始终通过 `makeFrames()` 生成确定性的 Canvas 2D probe。如果部署了 `neural-denoiser.onnx`，页面才会按 WebGPU/WASM 尝试可选的 ONNX Runtime 推理，并显示实际推理耗时；模型加载、形状检查或执行失败时回到同一个确定性 probe。

## 证据与边界

单独审核过的模型接受 `1×3×256×256` RGB 输入，包含八个卷积层。模型文件大小和 PyTorch/ONNX 数值一致性属于离线验证记录，当前浏览器 Canvas 画面不是那组验证帧。

已确认的 L1 与 PSNR 数值来自 16 个留出程序化场景的独立离线运行，只适用于自生成 Cornell 风格分布；它们不是当前 probe、浏览器速度、生产级降噪或泛化能力的测量。完整来源和限制见 `training/model-card.md`。
