---
routeSlug: engine-systems-explorer
translationKey: engine-systems-explorer
locale: zh-CN
title: Engine Systems Explorer
summary: 用可视化的 Render Graph、资源生命周期和帧调试视图解释一个现代渲染运行时如何组织工作。
year: 2026
status: in-progress
role: 独立开发 / 图形系统设计
platforms:
  - Windows
  - Web
technologies:
  - C++
  - Render Graph
  - RHI
  - GPU Profiling
heroImage: /media/placeholders/project-engine-systems-explorer.svg
responsibilities:
  - 设计 Pass、资源和依赖关系的数据模型
  - 建立资源首次使用、最后使用和别名复用的可视化表达
  - 将底层引擎概念整理为可观察、可复现的交互案例
featureSlugs:
  - render-graph
  - pass-culling
  - resource-lifetime
  - frame-inspector
demoSlugs:
  - render-graph
  - frame-inspector
articleSlugs:
  - rhi-abstraction-boundaries
  - render-graph-lifetime
architecture: 一个轻量的图数据模型描述 Pass 与资源，SVG 负责关系呈现，独立的分析函数计算拓扑排序、可见 Pass 和资源存活区间。
metrics: []
limitations:
  - 当前展示模型不执行真实 GPU 命令，仅用于解释调度和资源决策
  - 资源别名策略仍需接入真实后端后验证峰值显存收益
draft: false
---

## 项目结论

渲染器的复杂度不只来自着色器，也来自一帧中大量资源和 Pass 的关系。这个项目把这些关系从“代码里隐含的执行顺序”变成可以检查的图：访客可以关闭一个 Pass，观察依赖如何收缩；选中资源，则能看到它从首次写入到最后读取的存活区间。

## 为什么做它

在小型 Demo 中，直接调用几个渲染函数足够快；当后处理、阴影、透明、调试视图和异步计算同时出现时，手动维护 Render Target 和同步点会变得脆弱。Render Graph 的价值是把“我要什么结果”与“怎样安排资源”分开，让编译阶段能够做 Pass Culling、状态推导和临时资源复用。

## 核心模型

每个 Pass 声明读取和写入的逻辑资源，而不是持有某个具体的 GPU 对象。编译器执行三步：从最终输出反向遍历得到需要保留的 Pass；根据读写关系建立拓扑顺序；扫描资源的首次和最后一次使用，给可复用的临时资源分配别名区间。

```text
Shadow ──writes──> ShadowMap ──reads──> Lighting
GBuffer ──writes──> Normals ──reads──> Lighting
Lighting ──writes──> HDR ──reads──> Bloom ──reads──> Tonemap
```

可视化器不会假装这些节点就是某个特定引擎的实现。它展示的是边界和决策：Pass 的输入输出、资源状态、可选分支，以及在目标输出不需要某个分支时发生的裁剪。

## 我关注的工程问题

- 资源句柄只表达逻辑身份，不能跨帧随意保存。
- 读写声明必须足够精确，否则拓扑顺序和屏障推导都会失真。
- 调试视图应成为正式的输出节点，而不是绕过图的特殊路径。
- 别名复用需要同时考虑格式、尺寸、用法和并行执行约束。

## 当前边界

这是一个解释性工具，不将 SVG 图误称为真实 GPU 时间线。真实后端接入后，还需要用 RenderDoc、API 捕获和硬件计时器验证屏障、队列同步与峰值显存。下一步会把同一份声明式图映射到 WebGPU 的 Render Pass 和 Compute Pass，并保留可读的中间表示。
