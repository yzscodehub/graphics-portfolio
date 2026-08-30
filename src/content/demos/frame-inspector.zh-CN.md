---
routeSlug: frame-inspector
translationKey: frame-inspector
locale: zh-CN
title: Frame Inspector
summary: 用可切换的中间 Buffer 观察一帧从几何、深度到光照和最终颜色的变化。
category: engine
renderer: Canvas 2D Buffer 可视化
backend: canvas-2d
status: in-progress
featured: false
capabilities: []
requirements:
  - webgpu（优先）
  - webgl2（静态回退）
controls:
  - Final
  - Normal
  - Depth
  - Velocity
  - Lighting
  - SSAO / Tone Map
metrics: []
fallbackImage: /media/placeholders/demo-frame-inspector.svg
relatedProjects:
  - engine-systems-explorer
  - real-time-rendering-lab
relatedArticles:
  - render-graph-lifetime
draft: false
---

## 展示目标

调试视图把“画面不对”拆成可以检查的中间结果。Normal 用于检查方向与切线空间，Depth 保留非线性深度的解释，Velocity 和历史缓冲则帮助判断时间效果产生的拖影。

## 工程边界

视图切换是正式渲染输出的一种选择，不绕过 Demo 的资源生命周期。WebGPU 初始化失败时显示预计算 Buffer 图集，并保留每个视图的文字说明。
