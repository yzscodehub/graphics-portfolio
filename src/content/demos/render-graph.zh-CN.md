---
routeSlug: render-graph
translationKey: render-graph
locale: zh-CN
title: Render Graph Explorer
summary: 通过 Pass、资源和依赖关系的交互图理解调度、裁剪与临时资源复用。
category: engine
renderer: TypeScript + SVG
backend: svg
status: in-progress
featured: true
capabilities: []
requirements: []
controls:
  - Select Pass
  - Toggle Pass
  - Show Resource Lifetime
  - Show Aliasing
  - Reset Graph
metrics: []
fallbackImage: /media/placeholders/demo-render-graph.svg
relatedProjects:
  - engine-systems-explorer
relatedArticles:
  - render-graph-lifetime
draft: false
---

## 展示目标

这是一个完全可访问的架构 Demo，不需要 GPU。选择 Pass 会高亮输入、输出和依赖；关闭一个非最终输出分支后，图会重新计算需要保留的节点。

## 可观察信息

资源面板显示首次写入、最后读取和可复用区间。它呈现的是一个声明式 Render Graph 的分析结果，不冒充真实 API 捕获或硬件时间线。真实后端接入前，任何显存收益都只作为待验证假设。
