---
translationKey: render-graph-lifetime
routeSlug: render-graph-lifetime
locale: zh-CN
title: Render Graph 的依赖、资源生命周期和 Pass Culling
description: 从声明式 Pass 到拓扑排序、生命周期区间和别名复用，拆解 Render Graph 编译阶段真正要解决的问题。
category: engine-architecture
module: engine-systems
moduleOrder: 2
articleOrder: 2
order: 2
level: advanced
tags:
  - Render Graph
  - Resource Lifetime
  - GPU
readingMinutes: 18
prerequisites:
  - 理解渲染 Pass、附件与资源读写
  - 了解有向图、拓扑排序和资源状态
learningOutcomes:
  - 能用资源版本而不是调用顺序建立 Pass 依赖
  - 能计算生命周期、Pass Culling 与兼容 Alias Slot
  - 能区分逻辑 Usage Plan 和后端显式 Barrier
relatedProjects:
  - engine-systems-explorer
relatedDemos:
  - render-graph
  - frame-inspector
relatedArticles:
  - rhi-abstraction-boundaries
  - frame-inspector-observability
englishTitle: Render Graph Dependencies, Resource Lifetimes, and Pass Culling
englishDescription: From declarative passes to topology, lifetime intervals, and aliasing, a practical breakdown of render-graph compilation.
publishedAt: 2026-08-30
updatedAt: 2026-08-31
draft: false
---

## Render Graph 解决的不是“画图”

渲染代码最初往往是一串看起来直观的调用：先画阴影，再画 G-Buffer，然后做光照和后处理。随着功能增加，调用顺序同时承担了依赖、资源创建、状态切换和调试输出等职责。Render Graph 的核心转变是：Pass 声明“我读什么、写什么、需要什么附件”，编译器再根据最终输出决定真正执行什么。

这让资源生命周期成为可计算的数据，而不是散落在函数中的隐含约定。

## 最小数据模型

```cpp
struct ResourceUse {
  ResourceHandle resource;
  Access access;          // Read / Write / ReadWrite
  PipelineStage stage;
};

struct PassNode {
  std::vector<ResourceUse> reads;
  std::vector<ResourceUse> writes;
  ExecuteFn execute;
};
```

这里的句柄只是图内身份。真正的纹理或 Buffer 在编译完成后才分配或从缓存中取得。每个 Pass 必须明确声明读写，不能在执行回调里偷偷访问一个没有登记的资源；否则依赖和屏障都无法可靠推导。

## 从最终输出反向裁剪

不是所有注册的 Pass 都对当前帧有用。可以从导出资源开始反向遍历：找到最后写入它的 Pass，把该 Pass 的读取资源加入待遍历集合，直到没有新节点。未被访问的 Pass 被裁剪。

```text
exports = [swapchain]
required = reverse_reachable(exports)
schedule = topological_sort(required)
```

Pass Culling 必须以资源边为依据，而不是简单按标签删除。一个看似“调试用”的输出如果被明确导出，就应当保留整条依赖链；反过来，关闭 Bloom 时，与 Bloom 相关的临时纹理可以完全不创建。

## 拓扑排序与环

对保留的图做拓扑排序可以得到合法执行顺序。图中出现环时，不能通过随意打破顺序来“让画面先跑起来”，因为环通常意味着资源读写声明错误，或者需要显式的跨帧历史资源。

跨帧历史应当建模为两个不同的逻辑资源：`history[n - 1]` 是本帧的输入，`history[n]` 是本帧的输出。这样图内仍是有向无环图，交换发生在帧边界，而不是把上一帧的状态偷偷塞进当前图。

## 生命周期区间

对排好序的 Pass 编号后，资源的生命周期可以表示为：

```text
ShadowMap : [0, 2]
GBuffer   : [1, 3]
BloomTemp : [4, 5]
```

`firstUse` 是第一次写入或读取的节点位置，`lastUse` 是最后一次使用。一个临时资源只有在区间不重叠、描述兼容且不会跨并行队列冲突时才可能与另一个资源复用物理存储。仅凭“两个纹理名字不同”不能推断可以别名。

资源描述至少需要比较格式、尺寸、mip 数、采样数和 usage。某些后端还会对 UAV、颜色附件或深度附件有额外限制，这些限制应由后端能力反馈，而不是在通用层硬编码成假设。

## 状态和屏障

图编译器知道相邻使用之间的访问类型，就可以生成状态转换或屏障计划：写入 HDR 纹理之后，Bloom Pass 以采样读取；Compute Pass 写入 Buffer 之后，Indirect Draw 以间接参数读取。屏障描述应该保存前后阶段、访问类型和队列信息，执行器再翻译为具体 API。

不要把“每个 Pass 前放一个全局屏障”当作正确实现。它可能掩盖声明错误、损失并行机会，也让性能分析失去意义。更好的做法是提供严格验证模式：发现未声明的读取、重复写入冲突或不兼容状态时直接报错。

## 一个可测试的编译流程

```text
validate declarations
→ find required passes
→ topological sort
→ calculate resource intervals
→ allocate / alias transient resources
→ plan barriers and queue edges
→ emit executable schedule
```

每一步都应该有不依赖 GPU 的单元测试。测试一个被裁剪的 Pass 不会出现在计划中；测试环会被拒绝；测试两个不重叠且兼容的资源可以复用同一 slot；测试重叠或格式不兼容的资源不能复用。

## 调试视图是正式输出

Normal、Depth、Velocity 等调试视图不能绕过 Render Graph 直接从后端拷贝一份“神奇的纹理”。它们应该作为新的导出节点接入图，这样访客或开发者查看某个 Buffer 时，实际看到的依赖、生命周期和同步计划与正常渲染一致。

## 常见误区

- 把 Pass 列表叫作 Render Graph，却没有资源读写边。
- 用执行顺序推断依赖，导致隐藏读写和偶现竞态。
- 为了别名复用忽略并行队列和附件兼容性。
- 在执行回调内创建临时资源，使编译器无法裁剪。
- 用一个全局同步点修补声明错误。

Render Graph 的收益不应只写成“节点看起来很漂亮”。真正需要验证的是：无效分支是否不再执行，临时资源是否按生命周期复用，屏障是否只覆盖必要范围，以及错误是否能在编译阶段被解释。图只是表面，声明和可验证的编译过程才是系统。

## 资源版本：一次写入创建一个新身份

只用资源名建立依赖会遗漏覆盖写。假设 `history` 先被 Temporal Resolve 写入，后续 Debug Export 又写入同名资源；若两个写入仍被视为一个节点，读者无法说明自己消费的是哪次结果。

更明确的模型是：每次写入创建一个资源版本。

```text
history@0  --read--> TemporalResolve --write--> history@1
history@1  --read--> DebugExport     --write--> history@2
history@1  --read--> Present
```

Pass 的读依赖绑定到具体版本，writer 是唯一的，reader 可以有多个。编译器由此可以检测：

- 读取不存在的版本；
- 非导入资源在首次读取前没有 producer；
- 一个版本被多个 Pass 声称写入；
- 禁用 producer 后仍有存活 reader；
- 版本链形成依赖环。

当前 RenderGraphCore 在声明阶段记录资源用途，在编译阶段生成版本化访问和诊断。UI 选择 Pass 时显示它读取/写入的具体版本，而不是只显示资源基名。

## 从 Root 反向标记存活 Pass

Pass Culling 的根不是“最后一个数组元素”，而是外部可观察结果：Present、readback、导出资源或显式 side effect。编译器从根版本出发找到 writer，再递归找到 writer 所读取版本的 producer。

```ts
function markLive(pass: Pass) {
  if (live.has(pass)) return;
  live.add(pass);
  for (const read of pass.reads) {
    const producer = writerOf(read.version);
    if (producer) markLive(producer);
  }
}
```

未被标记的启用 Pass 才能被裁剪。若一个 Pass 进行外部 Query、日志 readback 或不可描述的插件调用，它必须声明 side effect；否则裁剪结果虽然符合图模型，却会改变程序行为。

## Alias Slot：兼容键与区间分配

资源生命周期是编译后执行序列中的 `[firstUse, lastUse]`。两个 transient 资源只有在区间不重叠且描述兼容时才可能共享物理分配。

兼容键至少包括：

- 资源种类与维度；
- 宽高深、mip、array layer、sample count；
- 格式或可安全重解释的格式集合；
- usage 超集；
- 对齐、内存类型与后端限制。

一个简单分配器可以按 first use 排序，尝试复用已经在当前位置前结束的 slot：

```text
depth@1    [0 ───── 3] → slot 0
albedo@1      [1 ── 3] → slot 1
ssao@1              [4] → slot 0  (interval disjoint + compatible)
history@1       [2 ───── 5] → slot 2
```

当前 Demo 使用确定性的 first-fit 兼容分配，目的是让 Inspector 可解释。生产实现还要考虑并行队列：两个 Pass 在拓扑顺序上相邻，不代表 GPU 时间上不重叠；没有跨队列 happens-before，就不能仅凭线性序号 alias。

## Usage Transition Plan 与后端映射

图编译器记录逻辑 usage 变化，例如：

```text
depth: depth-attachment → texture-binding
lighting: storage-binding → texture-binding
final: render-attachment → present
```

这个计划不等于所有 API 都存在同名 barrier。WebGPU 通过资源用途、Pass 边界和验证规则管理兼容访问；显式 API 则可能需要 stage/access、resource state、layout 或 queue ownership。RHI 后端应根据逻辑 usage 和 Capability 生成本地同步，而不是让 Render Graph 伪造一套“所有后端相同”的 barrier。

因此 Inspector 使用 `usage transition`，不把它标成硬件时间线或已发射的 Vulkan barrier。

## 编译流程要保持纯函数边界

理想的编译阶段接收声明与 Capability，输出计划或结构化错误：

```text
validate declarations
  → build version dependencies
  → detect cycles
  → find roots / mark live / cull
  → topological schedule
  → compute lifetimes
  → assign alias slots
  → build usage transition plan
  → emit inspector model
```

执行回调不应在编译期间偷偷创建图外资源或修改依赖。资源实例化和命令录制消费编译结果，但不能反向改变计划；否则同一声明无法得到确定结果，单元测试也失去意义。

## 三个可复现图变体

使用当前 Demo 的 Depth、GBuffer、SSAO、Lighting、Temporal Resolve、Present 和 Debug Overlay：

### 基线

保持所有生产链启用。记录 live pass、resource version、lifetime、alias slot 和 usage transition。

### 裁剪分支

Debug Overlay 不连接 Present，也没有 side effect。它应保持 enabled 但被编译器标记 culled；相关 transient 资源不进入最终分配。

### 缺失 Producer

禁用某个仍被存活 Pass 读取的 producer。编译必须返回 `missing-producer` 诊断，而不是自动使用未初始化资源。

再增加一个人工环，验证编译器输出参与环的 Pass/资源，而不是只说“排序失败”。

## 失败模式与诊断

- **依赖来自数组顺序。** 插入一个 Pass 就改变语义，声明边没有成为真相。
- **写入不创建版本。** 覆盖写与历史读无法区分。
- **Root 只认 Present。** readback 和工具导出被错误裁剪。
- **Alias 只比较尺寸。** 格式、sample、usage 或并行队列不兼容。
- **所有转换变成全局同步。** 正确但失去并行和带宽收益，也掩盖声明问题。
- **Inspector 使用另一份手写图。** UI 和执行计划迟早漂移。

## 验收检查表

- 同一声明是否总能生成相同 schedule？
- 每个资源版本是否只有一个 writer？
- 环、未知资源、未知版本和缺失 producer 是否 fail closed？
- 裁剪是否从外部可观察 roots 反向进行？
- 生命周期是否基于存活 schedule，而不是原始声明顺序？
- Alias 是否同时检查区间、描述和队列关系？
- Usage Plan 是否与后端 barrier 发射区分？
- Inspector 是否直接消费编译结果？

只有这些问题有自动化答案，Render Graph 才是渲染系统，而不是一张维护成本更高的流程图。
