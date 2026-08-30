---
routeSlug: render-graph
translationKey: render-graph
locale: zh-CN
title: Render Graph Explorer
summary: 使用 TypeScript 编译声明式 Render Graph，并以可访问 SVG 展示裁剪、生命周期、别名槽位和用法转换。
category: engine
renderer: TypeScript 编译器 + 可访问 SVG 检查器
backend: svg
status: completed
maturity: completed
evidence: measured
backends:
  - id: svg
    label: TypeScript 编译器 / 可访问 SVG
    role: primary
    capabilities: []
capabilities: []
requirements:
  - label: DOM 与 SVG
    required: true
fallback:
  kind: none
  description: 编译器和 SVG 检查器不依赖 GPU，因此不需要 GPU 回退。
controls:
  - Depth Prepass
  - G-Buffer
  - SSAO
  - Lighting
  - Temporal Resolve
  - Present
  - Debug Overlay
  - 通过点击、Tab、Enter 或 Space 选择 Pass
metrics: []
metricSource:
  kind: runtime
  description: compileMs 使用 CPU wall-clock 计时；检查器不把它描述为 GPU 执行时间。
fallbackImage: /media/demos/render-graph-poster.svg
relatedProjects:
  - engine-systems-explorer
relatedArticles:
  - render-graph-lifetime
draft: false
---

## 实际运行内容

Demo 使用 TypeScript 编译声明式图，并把生成的执行计划绘制成可访问 SVG。Pass 节点支持键盘和鼠标选择，检查器报告依赖、资源版本、生命周期、别名槽位和逻辑用法转换。

## 编译阶段

当前编译器会验证资源描述和引用、拒绝环、查找 Present 或 side-effect 根节点、裁剪不可达的启用 Pass、对存活计划做拓扑排序、计算资源首次/最后使用区间、为兼容临时资源分配别名槽位，并记录用法转换。切换 Pass 会重新编译；禁用必要生产者时会显示诊断，而不是静默生成误导性图像。

## 证据边界

`compileMs` 是这份小型图的 CPU wall-clock 测量。用法转换属于后端规划元数据，WebGPU 可能隐式满足兼容转换；Demo 不把它冒充成硬件 GPU 时间线。
