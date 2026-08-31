---
translationKey: webgpu-particles-path-tracing
routeSlug: webgpu-particles-path-tracing
locale: zh-CN
title: 原生 WebGPU 粒子和渐进式路径追踪
description: 用两个小型实验理解 WebGPU 的 Storage Buffer、Compute Pass、累积纹理和设备丢失处理。
module: gpu-compute
moduleOrder: 3
articleOrder: 2
level: intermediate
tags:
  - WebGPU
  - WGSL
  - Path Tracing
prerequisites:
  - 了解 WebGPU Device、Queue、Buffer 与 Texture
  - 读过基本 WGSL Compute Shader
learningOutcomes:
  - 能描述 WebGPU 资源用途、Bind Group 与 Pass 编码的关系
  - 能比较持续状态和渐进历史的双 Buffer 生命周期
  - 能设计初始化失败、device lost 和无 WebGPU 的降级路径
relatedProjects:
  - webgpu-compute-lab
relatedDemos:
  - gpu-particles
  - path-tracer
relatedArticles:
  - compute-geometry-performance
  - bvh-progressive-path-tracing
  - path-tracing-to-neural-denoising
englishTitle: Native WebGPU Particles and Progressive Path Tracing
englishDescription: Two compact experiments for understanding storage buffers, compute passes, accumulation textures, and device loss in WebGPU.
publishedAt: 2026-08-30
updatedAt: 2026-08-31
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
  position: vec2f;
  velocity: vec2f;
  age: f32;
  lifetime: f32;
  seed: f32;
  padding: f32;
};
```

绑定组只包含实际使用的资源；不需要的纹理不应为了“以后可能用到”一直保持绑定。Command Encoder 结束前，所有 Pass 的依赖和资源用途都应已经确定。

## Adapter、Device 与能力实测

仅检查 `navigator.gpu` 不足以证明 WebGPU 可运行。浏览器可能暴露入口，却因为系统策略、驱动或 headless 环境让 `requestAdapter()` 返回 `null`。初始化顺序应是：

```text
navigator.gpu
  → requestAdapter
  → inspect features / limits
  → requestDevice(requiredFeatures)
  → create resources and pipelines
```

只有 adapter 返回并成功创建 device，页面才把 WebGPU 标为可用。`timestamp-query` 是可选 feature：粒子主路径可以运行而计时显示 N/A，不能为了计时失败整个 Demo。

Limits 同样属于契约。工作组大小、Storage Buffer 上限、每阶段绑定数量和纹理维度应在创建前检查。质量等级根据实测能力选择资源规模，而不是按浏览器名称猜测。

## Usage 是资源契约的一部分

WebGPU 在创建 Buffer/Texture 时声明用途。用途不是性能提示，而是验证和实现分配的依据：

| 资源              | 必要用途                                        |
| ----------------- | ----------------------------------------------- |
| 粒子 A/B          | `STORAGE`，并由 Render Pipeline 以 storage 读取 |
| 参数              | `UNIFORM` + `COPY_DST`                          |
| Timestamp resolve | `QUERY_RESOLVE` + `COPY_SRC`                    |
| Readback ring     | `MAP_READ` + `COPY_DST`                         |
| Path accumulation | `TEXTURE_BINDING` + `STORAGE_BINDING`           |
| Canvas output     | `RENDER_ATTACHMENT`                             |

少声明会在绑定或编码时失败，多声明则可能扩大后端约束和内存选择。用途应来自实际 Pass 计划，不要把所有 flag 一次性打开。

## Bind Group 把角色固化下来

粒子 Ping-Pong 预建两组绑定：A 读/B 写和 B 读/A 写。路径追踪也预建两组 accumulation 绑定。帧循环只切换 index，避免频繁创建 Bind Group。

Pipeline Layout 是 Shader 接口的一部分。CPU 端 Buffer 编码、WGSL 结构体、Bind Group entry 和 Pipeline Layout 必须同时变化；其中任何一处漂移，都可能表现为 validation error 或看似随机的数据。建议给每组布局一个版本/哈希，并在错误状态显示 Pipeline label。

## Pipeline 创建必须显式收集错误

WebGPU validation error 不一定以普通 JavaScript 异常出现在同步 `createPipeline` 调用处。一个可诊断的初始化路径应：

1. 对 Shader Module 调用 `getCompilationInfo()`；
2. 收集所有 error message 与行列；
3. `pushErrorScope("validation")`；
4. 使用 `createComputePipelineAsync` / `createRenderPipelineAsync`；
5. `popErrorScope()` 并把 Pipeline label 写入错误；
6. 失败时销毁之前创建的部分资源。

当前 Particles、Path Tracer 和 Reference Frame 都采用这一模式。这样 Shader 写错不会留下一个状态为 running 的黑色 Canvas。

## 初始化是一笔事务

初始化可能在 device、Buffer、Shader、Pipeline、Texture 或 Bind Group 任一步失败。如果 catch 只切换 UI，却没有释放已经创建的对象，就会在每次 Retry 后累积资源。

可把初始化视为事务：局部收集创建成功的资源，全部完成后才发布为 `active`；中途失败则逆序销毁。理想的 Resize 也应先创建完整的新纹理/Bind Group，再替换旧集合，避免半更新状态。

当前 Path Tracer 与 Reference Frame 的 Resize 仍会先销毁旧尺寸资源，再创建新集合；页面运行时会捕获失败并进入明确 fallback，但这不等于完成了无缝事务替换。因此“create new → publish → destroy old”保留为下一阶段边界，而不是已经验证的当前能力。

页面层还有 generation guard：较早的异步初始化即使晚到，也不能覆盖新的 Controller。旧 scope 会立即 abort 和释放，Controller 返回后再次执行 dispose。

## 两种历史的共同点与差异

|                | 粒子状态                         | 路径追踪累积                    |
| -------------- | -------------------------------- | ------------------------------- |
| 历史内容       | 位置、速度、age、lifetime        | 线性 HDR running mean           |
| 每帧操作       | 确定性积分 + 条件重生            | 随机样本 + 平均                 |
| Ping-Pong 原因 | 避免状态读写竞争                 | 避免同一 Storage Texture 读写   |
| Reset 条件     | 用户 Reset、容量/规则变化        | 相机、场景、分辨率、bounce 变化 |
| 可继续 Pause   | 是                               | 是                              |
| 主要证据       | 生命周期不变量、timestamp source | SPP、BVH 对照、线性累积         |

共同原则是：历史必须有清楚的身份和 invalidation 条件。区别在于粒子每帧得到新状态，路径追踪则让同一像素估计逐步收敛。

## Device Lost 后不能复用同一 Canvas 类型

Canvas 一旦取得 `webgpu` context，不应在 device lost 后对同一元素请求 `2d` context。正确回退是挂载独立 Canvas 或显示 Poster，隐藏原 WebGPU Canvas，并在 Controller dispose 时恢复 DOM。

恢复流程还需要新的 adapter/device、Pipeline、Buffer、Texture 和 Bind Group。旧 device 的对象不能跨设备复用。页面显示 fallback 时也要保留丢失原因，而不是只写“初始化失败”。

## 可复现实验矩阵

### 能力路径

- `navigator.gpu` 不存在；
- `requestAdapter()` 返回 null；
- adapter 存在但无 timestamp-query；
- adapter/device 成功；
- device lost。

每条路径都应得到明确状态、可阅读说明和一致的 dispose 行为。

### 生命周期路径

- 连续 mount/dispose 多次；
- 初始化未完成时再次初始化；
- resize 期间切换质量；
- 页面隐藏和离开视口；
- 用户 Pause 与页面 Pause 叠加；
- Pipeline 编译故意失败。

检查项包括 RAF 是否停止、监听器是否移除、GPU 资源是否销毁、旧 generation 是否失效，以及页面是否只保留一个可见输出 surface。

## 当前边界

这篇文章关注 WebGPU 资源与执行模型。粒子性能模型在 Compute 模块展开；BVH、材质散射和 Monte Carlo 积分在 Ray Tracing 模块展开。当前实现没有 GPU culling、indirect draw、SAH BVH 或通用 Shader reflection。把边界拆开，反而能避免两个 Demo 的视觉差异掩盖它们共享的资源生命周期问题。

## 参考资料

- [WebGPU Specification](https://www.w3.org/TR/webgpu/)
- [WebGPU Shading Language Specification](https://www.w3.org/TR/WGSL/)
- [GPUWeb Device Lost Design](https://github.com/gpuweb/gpuweb/blob/main/design/DeviceLost.md)
