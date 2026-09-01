---
routeSlug: neural-graphics-lab
translationKey: neural-graphics-lab
locale: zh-CN
title: Neural Graphics Lab
summary: 一个进行中的 RGB/Guided 降噪对比，包含哈希留出资源、已审核 RGB 推理与 fail-closed Guided 质量门禁。
year: 2026
status: in-progress
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
  - SHA-256 资源校验
heroImage: /media/projects/neural-graphics-lab-cover.svg
architectureImage: /media/projects/neural-graphics-lab-architecture.svg
architectureAlt: "哈希留出配对、八层残差 CNN、ONNX WebGPU/WASM 选择和指标输出的数据流图。"
demoImage: /media/runtime/neural-graphics-lab-runtime.png
demoImageAlt: "显式运行已审核模型后的真实 ONNX Runtime WASM 画面，显示 held-out 输出、L1、PSNR 与 P50/P95。"
environment:
  - "截图系统：Windows NT 10.0 x64"
  - "浏览器：Chromium 151.0.7922.34，1600×1000 CSS px，DPR 1"
  - "后端：ONNX Runtime Web 单线程 WASM；WebGPU adapter 在 headless 环境不可用"
  - "输入：哈希校验的 1×3×256×256 held-out noisy/reference 配对"
reproduction: "点击 RUN REVIEWED MODEL；校验 manifest、浮点资源 SHA-256、输出 shape，并在预热后重新计算当前配对 L1、PSNR 和 P50/P95。"
responsibilities:
  - 维护不运行模型时使用的确定性 Canvas probe
  - 模型执行前校验留出 manifest 和配对浮点资源
  - 运行后针对留出参考计算 L1/PSNR，并报告推理 P50/P95
  - 记录模型来源和分布限制
featureSlugs:
  - deterministic-probe
  - hashed-heldout-pair
  - explicit-model-run
  - onnx-webgpu-wasm
  - offline-validation
demoSlugs:
  - neural-denoising
articleSlugs:
  - path-tracing-to-neural-denoising
evidence: measured
backends:
  - id: onnx-web
    label: ONNX Runtime WebGPU / 单线程 WASM
    role: primary
    capabilities:
      - webgpu
      - wasm
  - id: canvas-2d
    label: 确定性 Canvas 2D probe
    role: fallback
    capabilities: []
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
  description: 经审核模型显式运行成功前，始终保留确定性 Canvas probe。
  image: /media/projects/neural-graphics-lab-cover.svg
metricSource:
  kind: offline-validation
  description: L1/PSNR 来自独立留出验证记录；P50/P95 仅由浏览器显式推理运行测量。
metrics:
  - label: 验证集 L1 降幅
    value: 38.9%
    status: confirmed
  - label: 验证集 PSNR 提升
    value: +5.46 dB
    status: confirmed
  - label: ONNX 大小
    value: 62,986 bytes
    status: confirmed
architecture: 浏览器校验哈希留出配对，用户显式点击后选择 ONNX Runtime WebGPU 或 WASM，计算图像指标，并为所有失败保留确定性 Canvas 回退。
limitations:
  - 指标只适用于文档记录的程序化验证分布
  - 浏览器 probe 不是留出验证帧；不做生产场景、时间稳定性、任意 HDR 或统一耗时承诺
draft: false
---

## 实际运行内容

页面首先显示确定性 Canvas probe，用户可以查看 noisy、denoised、reference 和 error，而无需加载模型数据。点击 `RUN REVIEWED MODEL` 后，页面获取版本化留出 manifest 与配对浮点资源，校验字节长度和 SHA-256，再创建 ONNX Runtime WebGPU 或单线程 WASM 推理。

## 证据边界

预热后，审核运行针对哈希校验的留出参考计算 L1、PSNR，并报告推理 P50/P95。已确认的 L1、PSNR 和模型文件证据来自离线验证；初始 Canvas probe 不是该验证集，不能复现这些数值。

模型范围仅限于 model card 记录的小型程序化分布；纹理、运动、任意 HDR、复杂几何和生产场景迁移不属于现有证据。
