---
translationKey: shadow-temporal-aa
routeSlug: shadow-temporal-aa
locale: zh-CN
title: 从 Shadow Map 到 TAA：深度、速度与历史重投影
description: 在同一 Reference Frame 中拆解 Hard、PCF、PCSS、FXAA 与 TAA，解释阴影采样、Velocity、Depth Rejection、Neighborhood Clamp 和历史重置。
category: rendering
module: rendering
moduleOrder: 1
articleOrder: 2
level: advanced
tags:
  - Shadow Mapping
  - PCSS
  - TAA
  - Motion Vectors
readingMinutes: 18
prerequisites:
  - 理解投影矩阵、深度缓冲和纹理采样
  - 了解离屏 Render Target 与多 Pass 渲染
learningOutcomes:
  - 能区分阴影滤波与时域抗锯齿各自依赖的资源
  - 能解释 Velocity 重投影、深度拒绝和邻域裁剪的职责
  - 能为历史失效、设备丢失和模式切换设计明确重置路径
relatedProjects:
  - real-time-rendering-lab
relatedDemos:
  - shadow-aa
  - frame-inspector
relatedArticles:
  - material-lighting-color-pipeline
  - frame-inspector-observability
englishTitle: "From Shadow Maps to TAA: Depth, Velocity, and History Reprojection"
englishDescription: A shared-reference-frame study of shadow filtering, FXAA, temporal reprojection, depth rejection, neighborhood clamping, and history invalidation.
publishedAt: 2026-08-31
updatedAt: 2026-08-31
draft: false
---

## 两类问题，共用一组可见性证据

阴影解决“光源能否看到表面”，抗锯齿解决“像素采样能否稳定重建边缘”。它们并不是同一种算法，但都高度依赖深度、投影和采样位置。如果分别制作两个互不相干的场景，很难判断画面抖动来自 Shadow Map、几何边缘还是历史重投影。

当前 Shadow & AA Demo 因此复用同一个 Reference Frame：固定相机与程序化几何生成 GBuffer、线性深度、Velocity、HDR Lighting、SSAO、History 和 Final。阴影与 AA 只是选择不同 Pass 分支，Frame Inspector 则读取同一批真实附件。

```text
Light-space depth ───────────────┐
                                ├─ Deferred lighting ── HDR current ─┐
GBuffer + linear depth + velocity┘                                   │
                                                                     ├─ Resolve ─ Final
Previous HDR history + previous depth ── Reproject / Reject / Clamp ─┘
```

## Shadow Map 的基本不变量

Shadow Map 先从光源视角记录最近深度，再在相机着色阶段把当前表面位置投影到光源空间。若当前深度大于记录值，表面位于遮挡者之后。

真正困难的不是这次比较，而是四个边界：

- 光源投影视锥必须覆盖有效场景；
- 深度偏移要抑制自阴影，又不能制造 Peter Panning；
- 纹理分辨率决定可表达的空间频率；
- 采样核不能越界，也不能把非线性深度当作线性距离。

Hard Shadow 每个像素只做一次比较，适合作为基线。若 Hard 模式本身位置错误，继续增加 PCF 或 PCSS 只会模糊错误。

## PCF 与 PCSS 分别近似什么

PCF 在阴影纹理邻域做多次比较并平均可见性。它得到的是过滤后的遮挡比例，边缘宽度主要由固定采样核决定。PCF 可以减轻锯齿，但不能自然表达“遮挡者越远，半影越宽”。

PCSS 增加了遮挡者搜索：先估计接收面与平均 blocker 的距离，再据此放大过滤核。它近似面积光源下的接触硬化阴影。实验中应把它理解为一条可检查的近似链路：

```text
receiver depth
  → blocker search
  → average blocker depth
  → penumbra estimate
  → variable PCF radius
```

若 blocker 搜索没有结果，像素应保持完全可见；若过滤半径没有上限，远处接收面会产生不稳定的大核。当前 Demo 用固定范围的程序化场景验证模式差异，不宣称覆盖级联阴影、超大世界或生产级采样图案。

## FXAA 与 TAA 的数据需求不同

FXAA 只读取当前帧颜色，根据局部亮度梯度平滑高对比边缘。它不需要历史、Velocity 或前一帧深度，因此切换成本低、失败状态少；代价是无法恢复当前帧没有采到的子像素信息，并可能软化纹理细节。

TAA 将连续帧当作多次采样。当前帧相机投影加入 Halton jitter，使边缘落在不同子像素位置；随后通过 Velocity 找到上一帧对应位置，把历史颜色合并回来。它至少依赖：

- 当前 HDR Lighting；
- 当前线性 Depth；
- 当前到上一帧的 Velocity；
- 上一帧已 resolve 的 HDR History；
- 上一帧 Depth；
- 当前 jitter 与历史有效标记。

缺少其中任何一项，都不应该静默使用旧历史。

## 重投影、深度拒绝与 Neighborhood Clamp

对当前像素 `uv`，历史位置可表示为：

```wgsl
let previousUV = uv - velocity;
```

这只是入口。`previousUV` 越界时历史无效；前后帧深度差异过大时，像素往往发生了遮挡变化，也应拒绝历史。若深度通过，历史颜色仍可能来自错误表面，因此还要把它限制在当前像素邻域的颜色范围中。

当前 Reference Frame 的 resolve 顺序是：

1. 用 Velocity 计算上一帧坐标；
2. 检查坐标与历史有效标记；
3. 比较当前 Depth 和 History Depth；
4. 计算当前 3×3 邻域的最小、最大颜色；
5. 将历史颜色 clamp 到邻域范围；
6. 仅在验证通过时给予历史较高权重。

Depth Rejection 解决明显的 disocclusion，Neighborhood Clamp 限制历史把旧颜色拖入新表面。两者都不是万能修复：透明物体、反射、高频材质和非刚体动画还需要更丰富的响应策略。

## 什么时候必须重置 History

历史不是永久资源，它只对创建它的状态签名有效。当前实现会在以下变化后重置：

- 宽度或高度变化；
- AA 模式变化；
- Shadow 模式变化；
- 场景 revision 变化；
- 用户显式点击 Reset；
- WebGPU device lost 后重建。

相机切换、FOV 改变、曝光链路重构也应进入生产版状态签名。宁可丢掉一帧积累，也不要把不兼容历史解释成当前数据。

## 失败模式与观察信号

| 现象           | 优先检查                                   |
| -------------- | ------------------------------------------ |
| 阴影整体漂移   | light-space 矩阵、坐标约定、深度范围       |
| 接触面布满条纹 | depth bias、法线偏移、Shadow Map 精度      |
| 阴影离开物体   | bias 过大、接收面深度定义                  |
| TAA 拖影       | Velocity 方向、History UV、Depth Rejection |
| 相机静止仍闪烁 | jitter 序列、历史 reset、采样核            |
| 边缘过软       | 历史权重、Neighborhood Clamp、FXAA 叠加    |
| 切换模式后残影 | 状态变化没有 invalidation                  |

Frame Inspector 应同时查看 Velocity、Linear Depth、HDR Lighting 和 History。只看 Final 会把四类问题压成同一种“画面不稳定”。

## 可复现实验

1. 固定相机，依次切换 Hard、PCF、PCSS，记录接触处和远端半影；
2. 保持阴影模式不变，在 None、FXAA、TAA 间切换；
3. 冻结 Frame Inspector，检查 Velocity 静止区域是否接近零；
4. 触发 Reset，确认 History 从无效状态重新积累；
5. 改变窗口尺寸，确认历史不会跨分辨率复用；
6. 切换到无 WebGPU 环境，确认页面进入明确标注的 Canvas 对比，而不是空白画布。

实验记录应包含模式、浏览器、backend、分辨率和 frame index。本文不提供跨设备固定耗时，因为当前重点是时域资源的正确性与可观察性。

## 当前边界

Reference Frame 没有实现级联阴影、蓝噪声采样、透明物体 Velocity、动态分辨率、反应遮罩或锐化。PCSS 与 TAA 都是可审查的教学范围实现。它们证明的是资源和历史契约，而不是替代成熟引擎的完整后处理栈。
