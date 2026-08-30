---
routeSlug: engine-systems-explorer
translationKey: engine-systems-explorer
locale: zh-CN
title: Engine Systems Explorer
summary: 使用 TypeScript 编译 Render Graph，并通过可访问 SVG 展示执行计划。
year: 2026
status: completed
role: 独立开发 / 图形系统设计
platforms:
  - Web
  - TypeScript
technologies:
  - Render Graph
  - SVG
  - Resource Lifetime
  - Transient Aliasing
  - Usage Planning
heroImage: /media/projects/engine-systems-explorer-cover.svg
architectureImage: /media/projects/engine-systems-explorer-architecture.svg
architectureAlt: "Render Graph 声明、验证、裁剪、拓扑排序、生命周期、别名和检查器的数据流图。"
demoImage: /media/runtime/engine-systems-explorer-runtime.png
demoImageAlt: "Render Graph Explorer 的真实运行画面，显示 6 个存活 Pass、1 个裁剪 Pass 和资源别名槽。"
environment:
  - "截图系统：Windows NT 10.0 x64"
  - "浏览器：Chromium 151.0.7922.34，1600×1000 CSS px，DPR 1"
  - "后端：TypeScript + DOM/SVG；不需要 GPU 适配器"
  - "证据范围：视觉与 CPU 编译计划，不是 GPU 时间线"
reproduction: "打开 Render Graph Explorer，切换任意 Pass；检查诊断、拓扑计划、生命周期、alias slot 和 usage transition 是否同步更新。"
responsibilities:
  - 建模版本化资源、读写用法和 Pass 依赖
  - 编译根节点、诊断、裁剪、拓扑、生命周期、别名槽位和用法转换
  - 使用可访问、可选择的 SVG 节点呈现执行计划
featureSlugs:
  - graph-validation
  - topological-schedule
  - pass-culling
  - resource-lifetime
  - transient-aliasing
  - usage-transitions
demoSlugs:
  - render-graph
  - frame-inspector
articleSlugs:
  - rhi-abstraction-boundaries
  - render-graph-lifetime
  - frame-inspector-observability
evidence: measured
backends:
  - id: svg
    label: TypeScript 编译器 + 可访问 SVG 检查器
    role: primary
    capabilities: []
requirements:
  - label: DOM 与 SVG
    required: true
fallback:
  kind: none
  description: 编译器和检查器不依赖 GPU。
metricSource:
  kind: runtime
  description: compileMs 使用 CPU wall-clock 测量，不声称硬件 GPU 时间。
metrics: []
architecture: 声明层描述资源与 Pass；编译阶段验证、查找根节点、裁剪不可达工作、排序计划、计算生命周期、分配兼容临时别名并记录逻辑用法转换。
limitations:
  - 图可以编译并可视化计划，但不会提交后端 GPU 命令
  - 用法转换属于规划元数据，生产使用前仍需后端验证
draft: false
---

## 实际运行内容

项目将 Render Graph 声明编译为可检查的执行计划。Demo 包含深度、G-Buffer、SSAO、HDR 光照、时间历史、Present 和调试覆盖层等资源；每个 Pass 声明读取与写入，编译器据此推导关系，而不是依赖手写调用顺序。

## 编译证据

验证阶段会捕获重复资源/Pass、无效描述、未知资源、缺少生产者、未知版本和依赖环。启用的 Pass 从 Present 或 side-effect 根节点反向追踪，不可达工作会标记为 culled，存活计划则进行拓扑排序。每个资源版本都获得首次/最后使用位置、读写者信息；不重叠且兼容的临时资源会分配同一别名槽位。

检查器把存活和裁剪节点呈现为可访问 SVG，支持鼠标或键盘选择，并显示依赖、资源版本、生命周期、别名槽位和用法转换。

## 边界

CPU wall-clock 值只描述这份小型编译运行，不是 GPU 时间戳。计划可以映射到后端，但屏障发射、队列所有权和实际显存行为仍需 API 级验证。
