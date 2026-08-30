---
translationKey: webgpu-particles-path-tracing
routeSlug: webgpu-particles-path-tracing
locale: zh-CN
title: 原生 WebGPU 粒子和渐进式路径追踪
description: 用两个小型实验理解 WebGPU 的 Storage Buffer、Compute Pass、累积纹理和设备丢失处理。
category: gpu-performance
tags:
  - WebGPU
  - WGSL
  - Path Tracing
readingMinutes: 9
relatedProject: webgpu-compute-lab
relatedDemo: path-tracer
englishTitle: Native WebGPU Particles and Progressive Path Tracing
englishDescription: Two compact experiments for understanding storage buffers, compute passes, accumulation textures, and device loss in WebGPU.
publishedAt: 2026-08-30
updatedAt: 2026-08-30
draft: false
---

## 为什么放在一起

粒子和路径追踪看起来是两类效果，但都能暴露 WebGPU 的核心边界：资源必须声明用途，命令要在正确的 Pass 中编码，GPU 状态应尽量留在 GPU，历史数据何时失效必须由应用显式决定。一个持续更新状态，一个累积随机样本，刚好形成互补练习。

## 粒子：状态在 GPU 内循环

粒子结构可以包含位置、速度、寿命和颜色。Compute Pass 从输入 Storage Buffer 读取并向另一个 Buffer 写入，Render Pass 再将结果作为顶点或实例数据消费。

```text
stateA ──read──> compute ──write──> stateB
stateB ──read──> render
swap(stateA, stateB)
```

Ping-Pong 不是为了炫技，而是避免一个 Dispatch 中的读写竞争。每个工作组还必须检查全局索引是否超过实际粒子数，因为工作组大小通常不能刚好整除动态数量。参数 Buffer 可以保留在 GPU 可见内存中，由 CPU 每帧只写入很小的更新区域。

## 路径追踪：样本的时间维度

最小路径追踪器需要生成相机光线、求交、计算材质反射并累积样本。为了保持交互，小场景可以先用 CPU 构建 BVH，再把节点和三角形数据上传到 GPU。每一帧只增加一批样本，画面随着采样数增长而稳定。

累积的关键不是“把上一帧纹理加起来”，而是判断历史是否仍与当前参数对应。相机矩阵、投影、分辨率、材质、光源或采样策略改变，都应重置累积计数和历史纹理。

```text
camera/material signature changed?
  yes → clear accumulation, sampleIndex = 0
  no  → trace batch, blend into accumulation
```

随机序列也应随样本索引变化，否则每一帧会重复同一组路径。展示页可以提供 Samples Per Pixel 和反弹次数，但要说明它们是当前设备的交互参数，不是质量评级。

## WGSL 与资源绑定

WGSL 的结构体布局、对齐和绑定声明必须与 JavaScript/TypeScript 创建的 Buffer 一致。一个常见错误是 CPU 端按紧凑结构写入，着色器却因为对齐规则读取了不同偏移。建议把布局写成一份明确的文档或常量，并用小型验证 Buffer 检查关键字段。

```wgsl
struct Particle {
  position: vec4<f32>;
  velocity: vec4<f32>;
  life: f32;
};
```

绑定组只包含实际使用的资源；不需要的纹理不应为了“以后可能用到”一直保持绑定。Command Encoder 结束前，所有 Pass 的依赖和资源用途都应已经确定。

## 设备丢失与回退

GPU 设备可能因驱动重置、浏览器策略或系统资源变化而丢失。Demo 需要监听 device lost，停止提交、释放监听器和控制器，并将状态交给页面层。恢复并不等于继续使用旧 Buffer：资源、管线和绑定都要按能力重新创建。

不支持 WebGPU 的环境不应看到空白区域。粒子和路径追踪页提供静态图或录制视频，同时保留管线、参数和限制说明；这样内容价值不会被浏览器能力绑架。

## 测量与边界

区分 CPU 录制、队列提交、Compute、Render 和浏览器合成时间。没有时间戳查询时，不要把 `requestAnimationFrame` 间隔写成 GPU 时间。路径追踪实验不包含生产级光源采样、压缩 BVH 或去噪，粒子实验也不以粒子总数作为跨设备性能承诺。

WebGPU 的工程价值在于让资源和命令关系更明确。通过两个小实验，可以把这些关系从 API 调用变成可观察的数据和可解释的回退行为。
