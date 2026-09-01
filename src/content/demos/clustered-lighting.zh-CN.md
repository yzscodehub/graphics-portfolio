---
routeSlug: clustered-lighting
translationKey: clustered-lighting
locale: zh-CN
title: Clustered / Deferred Lighting
summary: 在共享 Research Courtyard 中比较 Naive Forward、Deferred 与 Clustered Lighting，检查 G-Buffer、深度切片、Cluster Light List、溢出和真实测量来源。
category: rendering
renderer: Raw WebGPU / Canvas 2D 回退
backend: raw-webgpu
status: completed
maturity: completed
evidence: measured
backends:
  - id: raw-webgpu
    label: 原生 WebGPU Clustered Renderer
    role: primary
    capabilities:
      - webgpu
  - id: canvas-2d
    label: 确定性 Cluster Heatmap 回退
    role: fallback
    capabilities: []
capabilities:
  - webgpu
requirements:
  - label: WebGPU
    required: false
    capability: webgpu
  - label: timestamp-query
    required: false
fallback:
  kind: canvas-2d
  description: WebGPU 不可用时显示标记明确的 Research Courtyard、Depth Slice 与 Cluster Occupancy 图，不冒充实时 G-Buffer。
  image: /media/demos/clustered-lighting-poster.svg
controls:
  - NAIVE
  - DEFERRED
  - CLUSTERED
  - 64 LIGHTS
  - 256 LIGHTS
  - 512 LIGHTS
  - FINAL
  - G-BUFFER
  - DEPTH SLICE
  - CLUSTER HEATMAP
metrics:
  - label: REFERENCE HARDWARE
    value: Windows 11 / RTX 4070 class / Chromium Stable / 1080p / DPR 1.0
    status: verified
    source: declared acceptance environment
metricSource:
  kind: runtime
  description: timestamp-query 可用时分别报告 GPU geometry、Compute assignment 和 lighting 时间。低频 64-light CPU reference readback 单独核对 GPU list membership 与 overflow。
currentLimit: Cluster List 当前由 CPU 构建并上传，Courtyard 仍为程序化场景，Frame Inspector 不共享此 Renderer 的 Heatmap 或 GPU 资源。
fallbackImage: /media/demos/clustered-lighting-poster.svg
relatedProjects:
  - real-time-rendering-lab
relatedArticles:
  - clustered-deferred-lighting
  - frame-inspector-observability
assetIds:
  - research-courtyard
modes:
  - naive
  - deferred
  - clustered
referenceScene: research-courtyard
sourceUrl: https://github.com/yzscodehub/graphics-portfolio/blob/main/src/demos/clustered-lighting.ts
draft: false
---

## 一个场景，三条光照路径

Naive Forward 逐像素遍历全部动态光源，Deferred 先写入 Albedo、Normal、Depth 等附件再执行屏幕空间光照，Clustered 则把视锥切分为三维 Cluster，并只为每个像素遍历所在 Cluster 的 Light List。三条路径使用同一相机、材质、灯光动画和输出变换，避免把场景差异误认为算法收益。

## 可检查的中间证据

Final 之外，页面允许查看 G-Buffer visualization、Depth Slice 和 Lights-per-cluster Heatmap。Raw WebGPU Compute pass 写入 fixed-offset cluster headers、light indices 和 overflow。状态栏显示 Light Count、GPU overflow readback、低频 64-light CPU/GPU verification 和测量来源。

## 当前边界

本 Demo 不实现 Hi-Z、Meshlet、透明物体的 Clustered Forward、阴影图集或通用 glTF 编辑器。当前运行时使用自制的程序化 Research Courtyard；独立审计的 asset manifest 只为后续 packed-scene 路径预留接口。Cluster Heatmap 只属于这个独立 renderer。Frame Inspector 当前使用独立的 Reference Frame，不声称显示此 Heatmap，也不声称共享 GPU 资源。
