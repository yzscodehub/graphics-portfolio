---
routeSlug: material-lighting
translationKey: material-lighting
locale: zh-CN
title: Material & Lighting Lab
summary: 使用 Three.js WebGPURenderer 与 TSL 检查 PBR 校准场景，并提供 WebGL2 和 Canvas 回退。
category: rendering
renderer: Three.js WebGPURenderer + TSL
backend: three-webgpu
status: completed
maturity: completed
evidence: verified
backends:
  - id: three-webgpu
    label: Three.js WebGPURenderer + TSL / WebGPU
    role: primary
    capabilities:
      - webgpu
  - id: three-webgl
    label: Three.js WebGPURenderer / WebGL2 回退
    role: fallback
    capabilities:
      - webgl2
  - id: canvas-2d
    label: 程序化 Canvas 2D 回退
    role: fallback
    capabilities: []
capabilities:
  - webgpu
  - webgl2
requirements:
  - label: 优先使用 WebGPU
    required: false
    capability: webgpu
  - label: WebGL2 自动渲染器回退
    required: false
    capability: webgl2
  - label: 渲染器失败时使用 Canvas 2D
    required: false
fallback:
  kind: canvas-2d
  description: Three.js 多后端渲染器无法初始化时，继续显示程序化 Canvas 2D 材质预览。
  image: /media/demos/material-lighting-poster.svg
controls:
  - Base Color
  - Metallic
  - Roughness
  - Exposure
  - "Tone Mapping: ACES / AgX / LINEAR"
  - "Debug: FINAL / NORMAL / ROUGHNESS / METALNESS / DIRECT / INDIRECT"
metrics: []
metricSource:
  kind: runtime
  description: 面板报告当前后端和 requestAnimationFrame 节奏，不发布跨设备固定 GPU 耗时。
fallbackImage: /media/demos/material-lighting-poster.svg
relatedProjects:
  - real-time-rendering-lab
relatedArticles:
  - rhi-abstraction-boundaries
draft: false
---

## 实际运行内容

实时路径使用 Three.js `WebGPURenderer` 和 TSL 节点材质，构建可重复的球体、地面、程序化 PMREM 房间、半球光、移动方向光、边缘光和轨道相机。材质采用 `MeshPhysicalNodeMaterial`，因此可以在不改变场景契约的情况下查看法线、粗糙度、金属度、直接光和间接光。

## 控件与回退

Base Color、Metalness、Roughness、Exposure 和 ACES/AgX/Linear 色调映射均连接到实时渲染器；Canvas 回退保留同一组材质控件。Three.js 在 WebGPU 不可用时可以在内部选择 WebGL2；多后端渲染器本身失败时，页面切换到明确标注的 Canvas 近似。

## 证据边界

本 Demo 验证材质和调试视图行为。指标面板报告后端和帧节奏，不是通用 GPU 基准，也不代表所有设备支持全部 Three.js WebGPU 特性。
