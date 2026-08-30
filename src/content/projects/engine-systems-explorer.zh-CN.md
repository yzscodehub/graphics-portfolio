---
routeSlug: engine-systems-explorer
translationKey: engine-systems-explorer
locale: zh-CN
title: Engine Systems Explorer
summary: 用 Canvas 2D 程序化图和帧视图展示渲染运行时的概念入口；真实图编译能力列为后续路线。
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
  - 绘制固定的 Pass 与资源依赖预览
  - 暴露 Pass 可见性和节点选择交互
  - 记录可视化原型与真实图编译器之间的边界
featureSlugs:
  - pass-dependency-preview
  - pass-toggle-preview
  - node-selection
  - buffer-view-preview
demoSlugs:
  - render-graph
  - frame-inspector
articleSlugs:
  - rhi-abstraction-boundaries
  - render-graph-lifetime
architecture: 当前 Demo 使用 Canvas 2D 绘制固定 Pass 节点及其声明式读写关系，控制器负责选择和切换可见节点；真实 Render Graph 编译器属于后续实现路线。
metrics: []
limitations:
  - 当前模型不执行真实 GPU 命令，也不提供 SVG 图、Pass Culling、资源生命周期计算或临时资源别名复用
  - 节点开关是可视化预览，不等同于编译器重新裁剪依赖图
  - 后续路线再接入真实 Render Graph、后端屏障和显存测量
draft: false
---

## 当前预览

渲染器的复杂度不只来自着色器，也来自一帧中 Pass 与资源的关系。当前 Demo 将五个固定节点、读写标签和选择状态绘制在 Canvas 2D 上，访客可以切换节点可见性并查看选中节点的声明。

## 与真实引擎的边界

当前实现没有 SVG 图、真实 GPU 命令、Pass Culling、资源生命周期分析或别名复用。节点开关只改变可视化预览，并不会像编译器那样重新裁剪依赖图。后续路线会将声明式图连接到真实后端，再用 API 捕获和硬件计时验证屏障、队列同步与显存行为。
