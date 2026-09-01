---
routeSlug: material-lighting
translationKey: material-lighting
locale: zh-CN
title: 材质与颜色管线
summary: 使用 Three.js WebGPURenderer 与 TSL 检查 PBR 校准场景，并提供 WebGL2 和 Canvas 回退。
category: rendering
renderer: Three.js WebGPURenderer + TSL
backend: three-webgpu
status: in-progress
maturity: in-progress
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
  - "材质预设：Dielectric / Metal / Rough / Clearcoat"
  - Base Color
  - Metalness
  - Roughness
  - Clearcoat
  - Clearcoat Roughness
  - Exposure
  - "Tone Mapping: ACES / AgX / LINEAR"
  - "视图：FINAL / NORMAL / ROUGHNESS / METALNESS / DIRECT ISOLATION / IBL ISOLATION"
metrics: []
metricSource:
  kind: runtime
  description: 面板报告当前后端和 requestAnimationFrame 节奏，不发布跨设备固定 GPU 耗时。
currentLimit: 真实 WebGPU 硬件证据仍待完成；Direct/IBL 是光照隔离视图而非捕获附件，帧节奏也不是可移植 GPU 基准。
fallbackImage: /media/demos/material-lighting-poster.svg
relatedProjects:
  - real-time-rendering-lab
relatedArticles:
  - material-lighting-color-pipeline
assetIds:
  - calibration-rig
modes:
  - pbr-calibration
  - debug-view
referenceScene: calibration-rig
sourceUrl: https://github.com/yzscodehub/graphics-portfolio/blob/main/src/demos/material-lighting.ts
draft: false
---

## 实际运行内容

实时路径会加载并校验本地 Calibration Rig 契约，再构建球体、圆角立方体、金属环、薄片、法线沟槽物体、粗糙度平面、程序化 PMREM 房间、灯光和轨道相机。受控物体共享 `MeshPhysicalNodeMaterial`，因此预设与调试视图始终使用同一套可重复场景契约。

## 控件与回退

Dielectric、Metal、Rough 与 Clearcoat 四个预设会设置精确的 Base Color、Metalness、Roughness、Clearcoat 和 Clearcoat Roughness。上述参数、Exposure 与 ACES/AgX/Linear 色调映射均连接到实时渲染器，并在 Canvas 近似路径中保持相同语义。Three.js 在 WebGPU 不可用时可以在内部选择 WebGL2。

## 证据边界

本 Demo 验证材质参数与光照隔离行为。Direct Isolation 会关闭 PMREM 环境，IBL Isolation 会关闭直射光；两者都不冒充捕获到的 Attachment。指标面板报告后端和帧节奏，不是通用 GPU 基准。

首次发生 WebGPU Device 或 WebGL Context Loss 时，控制器会释放旧 Renderer，并尝试一次受 Generation Guard 保护的 Three.js 重建；重建失败或第二次 Loss 才切换到明确标注的 Canvas 近似。
