---
translationKey: path-tracing-to-neural-denoising
routeSlug: path-tracing-to-neural-denoising
locale: zh-CN
title: 从路径追踪噪声到浏览器神经降噪
description: 以配对渲染图为起点，梳理残差 CNN 的训练、ONNX 导出、浏览器推理和评估边界。
category: deep-learning
tags:
  - Neural Graphics
  - PyTorch
  - ONNX
  - Denoising
readingMinutes: 11
relatedProject: neural-graphics-lab
relatedDemo: neural-denoising
englishTitle: From Path-Tracing Noise to Neural Denoising in the Browser
englishDescription: A reproducible path from paired renders to residual-CNN training, ONNX export, browser inference, and evaluation boundaries.
publishedAt: 2026-08-30
updatedAt: 2026-08-30
draft: false
---

## 先定义问题，而不是先选模型

路径追踪图像中的噪声来自有限样本和随机采样。神经降噪的目标不是把任意图像变得平滑，而是在输入采样预算固定的前提下，估计更接近高采样参考的结果。这个定义决定了数据如何生成、模型输入输出如何对齐，以及评估时必须保留哪些困难区域。

每个样本应使用同一相机、几何、材质和光照设置生成 `noisy` 与 `clean` 图像。参考图的采样数更高，但仍然只是离线估计，不应被称为绝对真值。训练集和验证集按场景隔离，避免相同场景的相邻裁剪泄漏到两个集合。

## 一个小型残差 CNN

为了让浏览器部署可解释，实验使用固定 `1×3×256×256` 输入的 8 层卷积残差网络：一层特征提取，三个各含两层卷积的残差块，最后一层预测 RGB 残差。输出为输入加预测残差，再在展示层做范围限制。

```text
noisy → conv stem → (conv → ReLU → conv + skip) × 3
      → residual head → noisy + residual → denoised
```

这里“8 层”按卷积层计数，不把激活、加法和裁剪算作卷积层。残差输出更容易与输入对照，也方便在训练早期观察模型是否只学到模糊化。模型小并不意味着结果一定好，容量、数据分布和损失函数仍需通过真实实验验证。

## 损失与评估

可以从 L1 或 Charbonnier 损失开始，先让输出在像素空间靠近参考；之后再考虑感知或频域项，但要注意它们可能改善视觉观感却偏离数值重建目标。评估至少保留未去噪输入、传统滤波、模型输出和参考四组结果，并在高频边缘、镜面高光、阴影和细线区域查看误差。

PSNR、SSIM 等指标只有在数据划分、颜色空间、裁剪策略和参考生成方式固定后才有意义。当前仓库没有真实权重、日志或指标，因此不写入任何“提升百分比”或推理速度承诺。

## ONNX 导出检查

训练完成后导出 ONNX，首先检查输入布局、dtype、动态维度和输出范围。随机输入经过 PyTorch 与 ONNX Runtime 后，应在明确的容差内一致；若差异来自算子或浮点精度，也要在模型卡中记录。

```text
PyTorch checkpoint
  → eval() + fixed example
  → ONNX export
  → ONNX Runtime numerical check
  → model card + checksum
```

模型权重不应因为“页面需要”而伪造。只有真实训练并经过数据来源、许可证和质量检查的文件，才可以放入 `public/models/`。

## 浏览器后端选择

ONNX Runtime Web 可以按能力选择 WebGPU 或 WASM。页面按 `WebGPU → WASM → 预计算` 回退，分别报告模型加载、预处理、推理和后处理时间。WASM 单线程更容易部署，但速度依设备变化；WebGPU 可能因驱动或浏览器限制初始化失败。

失败处理必须是可见的：模型下载失败、输入形状不符、执行后端不可用时，页面显示原因并使用预计算结果。访问者仍能阅读方法和限制，不会被一个 GPU 错误挡在项目之外。

## 训练脚本的边界

训练脚本只读取本地的配对 `.npy` 样本，不下载数据，不自动联网，也不把数据集提交到网站构建。数据目录、归一化范围、裁剪尺寸和验证划分都要写在运行记录中。没有样本时，脚本应给出清晰错误，而不是创建一份看似有效的随机权重。

## 当前边界与下一步

神经降噪是图形工程和机器学习的交叉问题：输入的采样模式、颜色空间、动态范围和时间信息会影响模型能学到什么。下一步应先生成受许可的配对数据，建立传统滤波基线，再对模型大小、误差区域和浏览器推理成本做对比。只有这些证据齐全，实验才适合从 Lab 升级为正式项目。
