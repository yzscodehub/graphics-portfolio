---
routeSlug: frame-inspector
translationKey: frame-inspector
locale: zh-CN
title: Frame Inspector
summary: 通过显式视图切换检查六个带标签的 Canvas 2D 程序化 Buffer 预览。
category: engine
renderer: Canvas 2D Buffer 可视化
backend: canvas-2d
status: in-progress
featured: false
capabilities: []
requirements:
  - 基础 Canvas 2D
controls:
  - Final
  - Normal
  - Depth
  - Velocity
  - Lighting
  - SSAO
metrics: []
fallbackImage: /media/placeholders/demo-frame-inspector.svg
relatedProjects:
  - engine-systems-explorer
  - real-time-rendering-lab
relatedArticles:
  - render-graph-lifetime
draft: false
---

## 展示内容

页面绘制 Final、Normal、Depth、Velocity、Lighting 和 SSAO 六个程序化面板。它们是用于命名和交互的确定性视觉 probe，不包含 WebGPU 设备、MRT attachment、捕获帧或生产 Buffer。

## 工程边界

点击面板或对应按钮会选中当前 probe，并更新 Canvas 状态行。真正的 WebGPU/MRT 帧检查器和捕获的 Buffer 图集保留为后续路线；当前实现可在基础 Canvas 2D 环境中运行。
