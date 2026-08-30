---
routeSlug: neural-graphics-lab
translationKey: neural-graphics-lab
locale: zh-CN
title: 神经图形实验室
summary: 从自生成 Monte Carlo 图像对出发，完成残差 CNN 训练、ONNX 导出、数值验证和浏览器推理的可复现链路。
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
  - 实现确定性的程序化 Monte Carlo 配对数据生成器
  - 训练并评估八层残差卷积网络
  - 验证 PyTorch/ONNX 数值一致性与浏览器模型体积
  - 实现 WebGPU、WASM 与确定性 Canvas 降级状态
featureSlugs:
  - paired-data-generation
  - residual-denoiser
  - onnx-parity
  - inference-timing
demoSlugs:
  - neural-denoising
articleSlugs:
  - path-tracing-to-neural-denoising
architecture: 本地 NumPy 渲染器生成彼此独立的训练与验证场景，PyTorch 训练固定形状残差 CNN，ONNX Runtime Web 选择 WebGPU 或 WASM，界面始终保留确定性降级结果。
metrics:
  - label: 验证集 L1 降幅
    value: 38.9%
    status: confirmed
  - label: 验证集 PSNR 提升
    value: +5.46 dB
    status: confirmed
  - label: ONNX 体积
    value: 62,986 bytes
    status: confirmed
limitations:
  - 结果只适用于小规模程序化渲染分布
  - 未进行时序、任意 HDR、纹理和生产场景评估
  - 不声明尚未在实际浏览器设备上测量的统一性能数字
draft: false
---

## 项目结果

这个项目不再停留在网络结构草图，而是覆盖了一条完整的可复现链路。数据集包含 64 个训练场景和 16 个独立验证场景，不使用外部图片或第三方模型权重；1-SPP 输入与独立采样的 64-SPP 参考一一配对。

网络包含八个卷积层，并通过零初始化残差输出层从严格恒等映射开始。经过 50 个 CPU 训练周期，选定检查点在程序化验证分布上将 L1 降低约 38.9%，PSNR 提升约 5.46 dB。

## 部署契约

```text
程序化配对数据 → PyTorch 残差 CNN → ONNX opset 17
               → ONNX Runtime WebGPU / WASM
               → 确定性 Canvas 降级
```

ONNX 模型为 62,986 字节，与 PyTorch 的最大绝对差异为 `8.94e-8`。网页会显示实际推理耗时，但不会声称一个脱离设备与后端的统一速度数字。

## 限制

生成器估计区域光直接照明、解析阴影和确定性环境项，因此属于路径追踪风格的教学数据，不是无偏生产级真值。模型卡将所有质量结论严格限定在独立的程序化验证集上。
