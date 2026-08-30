---
translationKey: render-graph-lifetime
routeSlug: render-graph-lifetime
locale: zh-CN
title: Render Graph 的依赖、资源生命周期和 Pass Culling
description: 从声明式 Pass 到拓扑排序、生命周期区间和别名复用，拆解 Render Graph 编译阶段真正要解决的问题。
category: engine-architecture
tags:
  - Render Graph
  - Resource Lifetime
  - GPU
readingMinutes: 11
relatedProject: engine-systems-explorer
relatedDemo: render-graph
englishTitle: Render Graph Dependencies, Resource Lifetimes, and Pass Culling
englishDescription: From declarative passes to topology, lifetime intervals, and aliasing, a practical breakdown of render-graph compilation.
publishedAt: 2026-08-30
updatedAt: 2026-08-30
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
