---
routeSlug: neural-denoising
translationKey: neural-denoising
locale: zh-CN
title: 神经网络降噪
summary: 在浏览器中运行经过验证的八层残差 CNN，对比 1-SPP 输入、64-SPP 参考、模型输出与误差视图。
category: machine-learning
renderer: ONNX Runtime Web
backend: onnx-web
status: completed
featured: true
capabilities:
  - webgpu
  - wasm
requirements:
  - 优先使用 WebGPU
  - 单线程 WASM 降级
controls:
  - 噪声 / 降噪 / 参考
  - 误差热力图
  - 运行后端与推理时间
metrics:
  - label: 验证集 L1 降幅
    value: 38.9%
    status: confirmed
  - label: 验证集 PSNR 提升
    value: +5.46 dB
    status: confirmed
fallbackImage: /media/placeholders/demo-neural-denoising.svg
relatedProjects:
  - neural-graphics-lab
relatedArticles:
  - path-tracing-to-neural-denoising
draft: false
---

## 实际运行内容

页面只在 Demo 进入视口后加载 `neural-denoiser.onnx`。ONNX Runtime 依次尝试 WebGPU 与 WASM，显示真实推理耗时；模型加载、形状检查或推理失败时，仍会保留明确标记的确定性 Canvas 降级画面。

经过审核的模型接收 `1×3×256×256` RGB 输入，共包含八个卷积层。ONNX 文件为 62,986 字节，使用 opset 17 导出；PyTorch 与 ONNX 最大绝对误差为 `8.94e-8`。

## 证据与边界

在 16 个独立程序化验证场景上，L1 从 `0.001054` 降至 `0.000644`，PSNR 从 `45.40 dB` 提升至 `50.85 dB`。这些结果只适用于自生成的 Cornell 风格分布，不代表生产级降噪或跨场景泛化能力。完整数据来源、训练记录和限制写在 `training/model-card.md`。
