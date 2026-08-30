---
routeSlug: render-graph
translationKey: render-graph
locale: zh-CN
title: Render Graph Explorer
summary: 检查固定的 Canvas 2D Pass 依赖预览，通过节点可见性切换和画布选择观察声明式关系。
category: engine
renderer: Canvas 2D 程序化 Pass 图
backend: canvas-2d
status: in-progress
featured: true
capabilities: []
requirements:
  - 基础 Canvas 2D
controls:
  - Depth Prepass
  - G-Buffer
  - Lighting
  - Temporal AA
  - Tone Map
  - 在画布中选择可见节点
metrics: []
fallbackImage: /media/placeholders/demo-render-graph.svg
relatedProjects:
  - engine-systems-explorer
relatedArticles:
  - render-graph-lifetime
draft: false
---

## 展示内容

这是一个不依赖 GPU 的 Canvas 2D 预览，绘制五个固定 Pass 节点及其声明式读写标签。按钮切换节点可见性，点击可见节点进行选择；当前实现不会编译或执行真实 Render Graph。

## 可观察边界

状态行报告所选节点的声明式读取和写入。它不会计算资源首次/最后使用、Pass Culling、SVG 关系、临时资源别名、屏障或 GPU 时间。这些能力保留为 Engine Systems 项目的后续路线。
