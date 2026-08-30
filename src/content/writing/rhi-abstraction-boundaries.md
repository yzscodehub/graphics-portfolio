---
translationKey: rhi-abstraction-boundaries
routeSlug: rhi-abstraction-boundaries
locale: zh-CN
title: 跨平台 RHI 应该抽象什么，不应该抽象什么
description: 从资源、管线、命令和能力查询四个边界讨论跨 Vulkan、DirectX 与 Metal 的渲染接口设计。
category: engine-architecture
module: engine-systems
moduleOrder: 2
articleOrder: 1
order: 1
level: advanced
tags:
  - RHI
  - Rendering
  - Architecture
readingMinutes: 16
prerequisites:
  - 了解至少一种现代显式图形 API
  - 熟悉 GPU 资源、Pipeline 与命令提交
learningOutcomes:
  - 能区分稳定跨平台语义与后端特有能力
  - 能设计 fail-closed 的 Capability 查询和资源创建接口
  - 能为 Vulkan、D3D12 与 Metal 建立可解释的 Mapping 表
relatedProjects:
  - engine-systems-explorer
relatedDemos:
  - render-graph
  - frame-inspector
relatedArticles:
  - render-graph-lifetime
  - compute-geometry-performance
englishTitle: What a Cross-Platform RHI Should—and Should Not—Abstract
englishDescription: A practical boundary map for resources, pipelines, commands, and capability queries across Vulkan, DirectX, and Metal.
publishedAt: 2026-08-30
updatedAt: 2026-08-31
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

## 从渲染意图到后端提交的数据流

抽象边界是否健康，可以从一条完整数据流判断：上层提供稳定意图，RHI 验证契约，后端完成映射，提交回执再把真实能力和错误返回给上层。

```text
Render feature / Render Graph
  → RHI descriptors + capability requirements
  → validation / normalization / cache key
  → backend objects + native synchronization
  → queue submission
  → typed result / diagnostics / measurement source
```

这条链路中最危险的做法是“为了方便”跳过验证：让后端在某次 Draw 才发现格式不支持，或者在创建失败后偷偷换一个更低精度格式。前者让错误离根因太远，后者让画面看似成功、证据却不可追踪。

推荐让资源创建返回显式结果：

```cpp
struct TextureCreateResult {
    RHITextureHandle handle;
    RHIFormat selectedFormat;
    RHICapabilityDecision decision;
    RHIError error;
};
```

若发生降级，`decision` 必须记录请求、实际选择和原因。上层可以拒绝降级，也可以把它显示在调试面板；RHI 不替产品策略做决定。

## Capability 与 Backend Mapping

Capability 不应只是 `supportsFeature = true`。至少要描述支持等级、限制和成本：

| 稳定语义   | Vulkan 映射            | D3D12 映射                       | Metal 映射                     | RHI 应公开的差异               |
| ---------- | ---------------------- | -------------------------------- | ------------------------------ | ------------------------------ |
| 资源用途   | image/buffer usage     | resource flags/state             | texture/storage mode/usage     | 格式与用途组合是否合法         |
| 描述符绑定 | descriptor set/layout  | root signature + descriptor heap | argument/resource binding      | 数量、动态索引、更新成本       |
| Pipeline   | pipeline layout + PSO  | root signature + PSO             | render/compute pipeline state  | 编译失败、缓存键、动态状态     |
| 队列       | queue family           | direct/compute/copy queue        | command queue                  | 可用队列、所有权转移、并发限制 |
| 同步       | stage/access + barrier | resource barrier + fence         | encoder boundary + event/fence | 可见性范围和模拟成本           |

表中的映射不是“一行代码等价关系”。例如两个后端都能完成资源拷贝，不代表队列所有权、布局转换和 fence 时机相同。RHI 可以统一 `CopyIntent`，但必须让 Capability 说明它会在哪个队列执行、是否需要跨队列同步以及是否会退回通用队列。

一个实用的支持等级可以是：

- `Native`：后端直接支持且成本模型符合预期；
- `Emulated`：语义可保持，但会引入额外 Pass、拷贝或同步；
- `Restricted`：只支持部分格式、尺寸、阶段或队列；
- `Unsupported`：创建前明确失败。

相比布尔值，这四类状态更适合驱动质量等级、测试矩阵和 UI 证据。

## 生命周期与句柄不能只靠约定

跨平台句柄通常隐藏本地对象，但不能隐藏所有权。需要回答：

1. 谁创建和销毁对象；
2. CPU 句柄失效时，GPU 是否仍在使用资源；
3. 延迟销毁以哪个 fence 或提交序号为准；
4. device lost 后旧句柄如何被拒绝；
5. transient alias 是否允许两个逻辑资源共享物理分配。

一种稳健做法是给句柄加入 generation，并让资源管理器记录最后一次 GPU 使用回执。重复释放、跨设备句柄和过期 generation 在进入后端前失败；真正的本地销毁进入 fence 驱动的回收队列。

## 三类架构失败

### 最低公分母

为了让所有后端“看起来一致”，删除多队列、稀疏资源或高级绑定模型。结果是高能力平台无法表达自身优势，而上层仍不得不绕过 RHI。

解决方式不是把所有扩展塞进核心接口，而是稳定基础语义，再用 Capability-gated extension 暴露可选能力。

### 后端泄漏

上层到处判断 `if Vulkan`、`if D3D12`，说明真正依赖的是能力或成本，却被写成 API 名称。应把判断改为结构化 Capability；只有后端实现内部保留原生类型和调用。

### 静默降级

创建 HDR Attachment 失败后自动换成 8-bit、timestamp 不可用却回报 CPU frame time、Compute Queue 不存在却悄悄改到 Graphics Queue。画面可能继续运行，但任何性能或质量结论都失去可信度。

降级可以存在，但必须成为结果的一部分，并进入日志、Frame Inspector 和自动化测试。

## 可复现实验：同一契约的多后端验证

设计一组不依赖窗口观感的 RHI contract tests：

1. 用同一描述创建 color、depth、storage 和 readback 资源；
2. 对每项记录请求格式、选择格式、用途与 Capability decision；
3. 构建同一条 Render Graph，导出 Pass、资源版本和 usage plan；
4. 故意请求一个不支持的格式/用途组合，验证创建前失败；
5. 提交 copy → compute → graphics，记录队列和 fence 关系；
6. 触发 device lost 或模拟 generation 变化，确认旧句柄被拒绝；
7. 比较后端结构化 trace，而不是只比较最终截图。

测试输出应包含 backend、adapter、driver、RHI capability snapshot、资源描述哈希和提交序号。只有这些身份都绑定，结果才适合跨机器比较。

## 设计检查表

- 接口表达的是上层稳定意图，还是某个 API 的函数名？
- 能力不足会失败、受限还是模拟？调用方能否看见？
- 格式、绑定、队列和同步成本是否进入 Capability？
- 资源句柄是否有设备与 generation 身份？
- Pipeline cache key 是否覆盖 Shader、Layout、Format 和状态？
- 时间数据是否标出队列、区间和计时来源？
- device lost、重复释放和不支持路径是否有自动化测试？

RHI 的价值不是让差异消失，而是让差异出现在正确、可查询、可测试的地方。
