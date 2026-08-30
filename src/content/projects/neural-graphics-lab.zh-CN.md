---
routeSlug: neural-graphics-lab
translationKey: neural-graphics-lab
locale: zh-CN
title: Neural Graphics Lab
summary: 用确定性程序化 probe 展示神经降噪页面契约；独立离线验证和可选 ONNX 部署保持明确分离。
year: 2026
status: completed
role: 独立图形与机器学习工程实践
platforms:
  - Python
  - Browser
  - WebGPU / WASM
technologies:
  - PyTorch
  - NumPy
  - ONNX
  - ONNX Runtime Web
  - WebGPU
heroImage: /media/placeholders/project-neural-graphics-lab.svg
responsibilities:
  - 维护浏览器页面使用的确定性 Canvas 2D noisy/reference probe
  - 记录单独审核的残差 CNN 离线训练与验证运行
  - 保持可选 ONNX 推理与确定性回退状态清晰可见
  - 将离线验证证据与浏览器当前画面分开
featureSlugs:
  - deterministic-probe
  - offline-validation-record
  - optional-onnx-path
  - model-card
demoSlugs:
  - neural-denoising
articleSlugs:
  - path-tracing-to-neural-denoising
architecture: 浏览器页面生成确定性 Canvas 2D probe，并可加载经审核的 ONNX 文件；离线数据生成、训练和验证记录与当前画面分开维护。
metrics:
  - label: 验证集 L1 降幅
    value: 38.9%
    status: confirmed
  - label: 验证集 PSNR 提升
    value: +5.46 dB
    status: confirmed
  - label: ONNX 文件大小
    value: 62,986 bytes
    status: confirmed
limitations:
  - 浏览器画面是确定性程序化 probe，不是独立离线验证渲染，也不是实时路径追踪输出
  - 确认过的质量指标只能来自独立留出离线验证集，不能从当前 probe 推导
  - 没有时间序列、任意 HDR、纹理和生产场景评估；浏览器设备耗时不作统一承诺
draft: false
---

## 项目结果

神经降噪页面始终先生成 `makeFrames()` 的确定性 Canvas 2D probe，用于稳定展示 noisy、denoised、reference 和 error 四种视图。它不是独立验证集的截图，也不代表实时路径追踪画面。

项目同时保留一条单独审核的离线记录：残差 CNN 有八个卷积层，接受 `1×3×256×256` RGB 输入；离线验证集中记录了 L1、PSNR 和 ONNX 数值一致性。浏览器若发现经审核的 ONNX 文件，才尝试 ONNX Runtime WebGPU/WASM；失败时回到同一个确定性 probe。

## 证据边界

当前确认的指标来自独立留出的程序化验证场景，不来自浏览器当前画面。它们只适用于那套自生成分布，不能转化为生产级降噪、跨场景泛化或统一浏览器性能承诺。完整来源、训练记录和限制写在 `training/model-card.md`。
