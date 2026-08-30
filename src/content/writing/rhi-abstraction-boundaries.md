---
translationKey: rhi-abstraction-boundaries
routeSlug: rhi-abstraction-boundaries
locale: zh-CN
title: 跨平台 RHI 应该抽象什么，不应该抽象什么
description: 从资源、管线、命令和能力查询四个边界讨论跨 Vulkan、DirectX 与 Metal 的渲染接口设计。
category: engine-architecture
tags:
  - RHI
  - Rendering
  - Architecture
readingMinutes: 9
relatedProject: engine-systems-explorer
relatedDemo: render-graph
englishTitle: What a Cross-Platform RHI Should—and Should Not—Abstract
englishDescription: A practical boundary map for resources, pipelines, commands, and capability queries across Vulkan, DirectX, and Metal.
publishedAt: 2026-08-30
updatedAt: 2026-08-30
draft: false
---

## 先给结论

RHI 的任务不是把所有图形 API 伪装成同一种 API，而是把上层真正依赖的语义稳定下来，把后端差异留在能够观察和测试的边界内。一个健康的抽象通常统一资源身份、管线描述、命令生命周期和能力查询；它不会为了“所有后端都一样”而抹掉同步、绑定模型和队列能力的差异。

如果抽象层只保留最低公分母，项目初期会很舒服，后期却会在高级功能、性能调试和错误定位上付出代价。反过来，如果把某个后端的每个细节原样暴露给上层，所谓跨平台就只剩下命名转换。

## 先区分四类东西

### 1. 资源身份与资源存储

上层需要知道一个纹理或 Buffer 的逻辑身份、格式、尺寸、用途和生命周期。它不应该依赖后端对象的地址，也不应该把一个可回收的句柄长期保存到下一帧。

```cpp
struct TextureDesc {
  Extent3D extent;
  Format format;
  TextureUsage usage;
  uint32_t mipLevels;
};

class TextureHandle {
public:
  uint32_t id() const noexcept;
};
```

`TextureHandle` 只描述逻辑资源；真正的 `VkImage`、`ID3D12Resource` 或 Metal 对象由后端和资源管理器负责。这样 Render Graph 可以在编译时推导资源状态，也能把临时资源映射到不同的物理存储。

### 2. 管线描述与管线对象

顶点布局、着色器阶段、混合、深度和附件格式是上层渲染语义；管线缓存、编译任务和驱动对象是后端实现。两者应通过不可变描述连接，而不是让上层直接修改一个“万能管线对象”。

```text
PipelineDesc + RenderTargetLayout
            ↓ validate / specialize
BackendPipeline
```

描述必须包含足够的信息来拒绝无效组合。例如，片元着色器写出的附件数量与渲染目标布局不一致时，应在创建或编译阶段失败，而不是在某个 GPU 驱动上得到未定义结果。

### 3. 命令录制与提交

`CommandList` 可以是跨后端共享的概念，但“录制完成后是否可重复提交”“是否允许多线程录制”“提交属于哪个队列”不能被一个模糊的 `submit()` 隐藏。上层至少需要知道命令的所有权和同步前置条件。

更稳妥的边界是：命令上下文只接受已经验证的资源和管线，提交器负责队列选择、栅栏和帧进度。后端可以把 Vulkan 的显式屏障、D3D12 的资源状态或 Metal 的编码器边界映射到这套生命周期，但不必假装它们是同一种机制。

### 4. 能力查询

能力不是编译期的一个平台宏。纹理格式、原子操作、时间戳、异步计算、绑定数量和可用的压缩格式都可能由设备决定。建议把能力设计为结构化快照，并在功能选择点进行检查：

```cpp
struct DeviceFeatures {
  bool timestampQueries;
  bool compute;
  bool indirectDraw;
  FormatSet sampledFormats;
};
```

能力查询只回答“能不能”和“限制是什么”，不偷偷替上层选策略。真正的降级策略应该出现在渲染功能或资源创建器中，这样测试可以覆盖每一种路径。

## 不应该抽象的内容

同步是最容易被错误隐藏的部分。用一个跨平台的 `ResourceBarrier` 结构统一表达所有状态有价值，但如果它不能说明读写阶段、队列所有权和可见性范围，就只是在把危险推迟到后端。相似地，绑定模型可以提供统一的资源组描述，却不应承诺所有 API 都能以相同成本支持任意动态绑定。

调试信息也不应该被抽象成一个失真的“GPU 时间”。不同后端的时间戳精度、队列和提交范围不同。RHI 可以提供查询接口和来源标记，上层工具则应明确显示“哪一个队列、哪一个区间、以什么时钟测量”。

## 一条可执行的判断规则

新增一个 RHI API 前，问三个问题：

1. 上层是否依赖稳定的语义，而不是某个后端名字？
2. 这个语义能否在能力不足时被明确拒绝或降级？
3. 是否能写一个不需要真实 GPU 的验证测试？

如果三个问题都能回答“是”，它大概率属于抽象层。如果只能通过隐藏后端差异、丢失性能信息或返回一个含糊的布尔值来实现，就应该把它留在后端或单独建能力扩展。

## 验证方式

抽象层要同时测试正向和失败路径：无效格式组合、资源错误用法、重复释放、跨帧句柄、能力缺失和设备丢失。再用同一个 Render Graph 运行后端一致性测试，比较资源状态、附件布局和输出摘要，而不是只比较“窗口有没有画出颜色”。

RHI 的成功标准不是最少的代码，而是上层能够表达渲染意图，后端能够保留自己的能力，问题能够在正确的边界暴露。跨平台的价值最终体现为可维护的语义和可解释的差异。
