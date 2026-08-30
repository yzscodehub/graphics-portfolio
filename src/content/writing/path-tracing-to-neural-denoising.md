---
translationKey: path-tracing-to-neural-denoising
routeSlug: path-tracing-to-neural-denoising
locale: zh-CN
title: 从路径追踪噪声到浏览器神经降噪
description: 用可校验的配对渲染、八层残差 CNN、ONNX 导出和显式浏览器运行，建立一条不混淆离线质量与设备耗时的神经图形证据链。
category: deep-learning
module: neural-graphics
moduleOrder: 6
articleOrder: 1
order: 1
level: advanced
prerequisites:
  - 路径追踪的有限采样与蒙特卡洛估计
  - PyTorch 中卷积网络、训练集与验证集的基本概念
  - ONNX Runtime Web 的执行后端与浏览器资源加载基础
learningOutcomes:
  - 区分高采样参考、离线验证指标与浏览器端单次运行数据的证据边界
  - 设计可复现的配对渲染、模型导出与哈希校验流程
  - 为 WebGPU、单线程 WASM 和确定性回退建立明确的失败路径
relatedProjects:
  - neural-graphics-lab
relatedDemos:
  - neural-denoising
relatedArticles:
  - webgpu-particles-path-tracing
tags:
  - Neural Graphics
  - PyTorch
  - ONNX
  - Denoising
readingMinutes: 19
englishTitle: From Path-Tracing Noise to Neural Denoising in the Browser
englishDescription: A reproducible path from paired renders to residual-CNN training, ONNX export, browser inference, and evaluation boundaries.
publishedAt: 2026-08-30
updatedAt: 2026-08-31
draft: false
---

## 问题与边界：降噪不是把图像“磨平”

路径追踪的噪声来自有限样本的随机估计。给定相机、几何、材质与光照，低采样图像不是“坏图”，而是同一个积分在较少随机样本下的一次估计。神经降噪器的任务也因此应被限定为：在已知输入分布和采样预算内，估计一个更接近高采样参考的 RGB 结果；它不是面向任意图片的锐化器，也不能凭一张图证明自己适用于生产渲染器。

本文记录的实验刻意保持小范围。场景由本地程序化 Cornell 风格房间、球体、材质与区域光源组成；训练和验证使用不同的场景参数与种子。`clean` 是相同场景的独立高采样估计，不是绝对真值。这个边界决定了下面所有数字的解释方式：它们只描述该程序化分布上的误差，不描述电影级路径追踪、真实视频或任意 HDR 图像。

为了避免把不同性质的证据混成一句“模型效果很好”，需要将流程拆成三层：

```text
离线配对数据 ──> 训练 / 验证 ──> 固定验证指标
      │                                  │
      └──> 审核后的 ONNX ──> 浏览器显式运行 ──> 当前设备 P50 / P95
                                      │
                                      └──> 失败时保留确定性 Canvas probe
```

离线验证回答“模型在固定验证集上离参考有多近”；浏览器计时回答“这台设备、这个后端、这次运行用了多久”。两者缺一不可，但不能互相替代。

## 数据流：从随机估计到已校验的留出配对

训练数据的最小契约是成对且同构：每个 `noisy` 与 `clean` 文件必须来自相同的相机、几何、材质、灯光、颜色管线和图像尺寸，只改变采样序列与样本数。本实验输出 `256 × 256 × 3` 的 `float32` RGB 数据，训练时转为 `NCHW` 的 `1 × 3 × 256 × 256` 张量。颜色路径是线性辐射度累积，再经过 Reinhard tone mapping 与 `1 / 2.2` gamma，最终归一化到 `[0, 1]`。

审核运行使用的配置为：64 个训练场景、16 个验证场景，输入为 **1-SPP** 的独立低采样估计，参考为 **64-SPP** 的独立高采样估计。训练种子范围与验证种子范围分离，不能把同一场景的相邻裁剪或同一随机序列同时放进两个集合。验证集仍共享同一个程序化渲染器假设，所以“留出”意味着未见场景参数，不意味着跨渲染器泛化。

公开页面不直接相信“文件下载成功”。显式运行时，页面先取得版本化 held-out manifest，检查：

- `split` 必须是 `val`，布局必须是 `NCHW`，dtype 必须是小端 `float32`；
- shape 必须是 `1 × 3 × 256 × 256`；
- noisy 与 reference 二进制文件的字节长度和 SHA-256 必须与 manifest 一致；
- 模型文件必须存在且满足公开的大小上限；输出长度必须与输入长度一致。

这里的 SHA-256 校验约束的是浏览器使用的留出输入和参考，防止内容或字节序被替换后仍显示一组貌似合理的图像。它不把一次网页运行伪装成完整验证，也不把 Canvas 的程序化预览称作真实模型输出。

## 实现：一个足够小、但可审计的残差 CNN

模型是 `ResidualDenoiser-8conv`：8 个卷积层、16 个特征通道，导出的 ONNX 文件为 **62,986 bytes**。结构由一个 RGB 特征 stem、三个两层残差块和一个 RGB residual head 构成。网络预测的是对输入的修正量，而不是直接重新生成整张图：

```text
noisy_rgb
  -> 3×3 stem + ReLU
  -> [3×3 conv + ReLU + 3×3 conv + skip] × 3
  -> 3×3 residual head
  -> clamp(noisy_rgb + predicted_residual, 0, 1)
```

这种结构的工程价值不是“层数少所以一定快”。它把输入、输出、容量和部署尺寸固定在一个容易审查的范围内：模型输入名为 `noisy_rgb`，输出名为 `denoised_rgb`，ONNX opset 为 17；导出前必须进入 `eval()`，并用同一固定形状做 PyTorch/ONNX 数值比较。残差头在训练开始时以零初始化，使未训练模型近似恒等映射，避免一开始就把输入随机破坏；这同样不构成最终质量保证。

浏览器的执行顺序也是一份接口契约，而不是“尽量快”的泛化承诺：

1. 页面默认只显示确定性 Canvas probe，不静默下载模型或制造推理时间。
2. 用户点击 `RUN REVIEWED MODEL` 后，才下载并校验 held-out noisy/reference 数据，再加载审核后的 ONNX。
3. 若 `navigator.gpu` 可用，先请求 ONNX Runtime WebGPU；失败或不可用时改用单线程 WASM。
4. WASM 仍失败、模型加载失败、manifest 不兼容、哈希错误或输出 shape 不匹配时，保留可见的确定性回退，并显示失败原因。

静态 GitHub Pages 没有为多线程 WASM 所需的跨源隔离响应头提供该运行条件，因此这里明确设置 WASM 单线程。它是部署约束，不是对 WASM 性能的评价。

## 测量与证据：先说明每个数来自哪里

离线验证在全部 16 个验证场景上计算 display-referred RGB 的全局、逐元素 L1、MSE 和 PSNR；不裁剪，不挑选“效果最好”的帧。取峰值 `MAX = 1` 时：

```text
L1   = mean(|prediction - reference|)
MSE  = mean((prediction - reference)²)
PSNR = 10 × log10(MAX² / MSE)
```

已记录的验证结果如下。左列是 1-SPP 原始输入，右列是模型输出；两列都相对同一个 64-SPP 参考计算：

| 指标 |  1-SPP 输入 | 8-conv 输出 |
| ---- | ----------: | ----------: |
| L1   | 0.001053629 | 0.000643527 |
| PSNR |  45.3963 dB |  50.8521 dB |

这说明该模型在这 16 个留出程序化场景上的 L1 降低，PSNR 增加；它**不**说明任何浏览器、GPU 或生产场景的吞吐量。导出检查也有独立证据：本地 ONNX Runtime CPU 与 PyTorch 的平均绝对差为 `1.22945e-9`，最大绝对差为 `8.94070e-8`，低于 `1e-4` 容差。这个 parity 仅说明相同输入下导出的图与训练框架数值一致，并不能证明模型泛化。

浏览器页面则有另一套测量规则。模型 session 创建和输入验证完成后，先运行 **5 次 warmup**，再记录 **20 次** `session.run()` 的耗时，计算 P50 与 P95。计时区间只覆盖这 20 次推理调用；网络下载、SHA-256、模型解码、session 创建、首轮编译和 Canvas 绘制不被偷塞进“推理 P50/P95”。这些运行时数值只在用户显式点击后出现，并随浏览器版本、驱动、GPU、CPU 和被选中的 WebGPU/WASM 后端而变。

## 失败模式：把不可信结果拒绝在边界上

**数据配错。** 文件名相同并不足以说明配对正确；相机、颜色空间、曝光或裁剪发生变化时，网络会学习错位或错误的色调映射。生成阶段应保存 scene seed、SPP、颜色管线和数据集 manifest；训练前应拒绝未匹配 stem、非有限数值、非 `[0,1]` 范围和错误 shape。

**验证泄漏。** 同一场景的相邻样本、同一随机流或同一相机仅换噪声不能同时出现在 train/val。当前验证以独立 seed 和场景参数隔开，但仍不能代替跨场景资产、跨照明模型或跨渲染器测试。

**导出漂移。** 导出时错误的输入 layout、动态维度、算子实现或 clamp 行为都会造成“Python 看起来正确，浏览器不同”的问题。应在发布 ONNX 前保存 checkpoint hash、ONNX hash、输入输出名、模型大小和 PyTorch/ONNX 最大误差；发生越界时直接让导出或评估失败。

**浏览器后端失败。** WebGPU adapter 存在不等于 ONNX Runtime WebGPU 一定能建 session；WASM 可用也不保证模型、内存或 shape 正确。后端失败必须进入下一个后端或确定性 probe，而不是留下一块黑色 Canvas，更不能把 box filter 的展示结果标为网络推理。

**把比较对象弄错。** 初始 Canvas probe 是为了让页面可读和可测试，它不是 held-out 验证帧。页面运行后对一个已校验 held-out pair 重新计算的 L1/PSNR，也不是覆盖全部 16 个验证场景的离线聚合结果。界面和文章都应写明这一差别。

## 可复现实验：从数据到网页运行的最短证据链

1. 在受控 Python 环境中生成 64/16 个 `256²` 场景，明确指定 `--noisy-spp 1 --clean-spp 64`，保存 `dataset-manifest.json` 及其 SHA-256。
2. 以固定种子训练 16-channel、8-conv 网络；将 checkpoint、环境版本、训练参数和验证记录一并保存。不要将原始数据或随机权重当作网页素材提交。
3. 在完整 validation split 上运行离线评估，记录 noisy 与 denoised 的 L1、MSE、PSNR；导出 ONNX 后运行 PyTorch/ONNX parity，且用明确容差拒绝不一致结果。
4. 将经审核的 ONNX、held-out `.f32` 配对和 manifest 放到静态资源路径。重新计算文件字节数与 SHA-256，确保网页 manifest 中的值来自这些最终文件。
5. 打开页面后先确认未点击时没有模型请求。点击 `RUN REVIEWED MODEL`，记录选择的后端、任何回退原因、5 次预热后 20 次样本的 P50/P95；将这些设备数据标注为运行时数据，而不是离线质量结论。

这个过程允许实验失败：缺模型、哈希不匹配、WebGPU 不可用或 parity 超容差都应该停止相应断言，而不是修改文字去迎合页面展示。

## 限制与检查清单

当前证据只覆盖小型、静态、程序化 RGB 分布。它不覆盖纹理、运动矢量、时域稳定性、复杂透明/体积效应、任意 HDR 颜色空间、跨厂商渲染器或生产资产。64-SPP 参考也仍含有限采样误差；显示域 PSNR 可能掩盖 HDR 高光中的误差。网络还可能在分布外场景中抹掉真实边缘、镜面细节或制造颜色偏移。

发布或更新该 Demo 前，至少检查：

- [ ] 数据集和 held-out 资源的 SHA-256 与 manifest 一致；
- [ ] 1-SPP/64-SPP、64/16 场景、颜色管线和验证范围在页面与模型卡中一致；
- [ ] ONNX 大小、输入输出契约及 PyTorch/ONNX parity 有真实记录；
- [ ] 离线 L1/PSNR 与浏览器 P50/P95 分开标注；
- [ ] WebGPU、单线程 WASM 和确定性回退均能解释失败；
- [ ] 没有将该结果扩展为生产降噪、通用图像增强或固定性能承诺。
