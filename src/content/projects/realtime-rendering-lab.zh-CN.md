---
routeSlug: real-time-rendering-lab
translationKey: real-time-rendering-lab
locale: zh-CN
title: Real-Time Rendering Lab
summary: 一个完成的 Three.js WebGPURenderer 与 TSL 材质实验台，自动回退到 WebGL2 和 Canvas。
year: 2026
status: completed
role: 独立开发 / Rendering Engineer
platforms:
  - WebGPU
  - WebGL2
  - Canvas 2D fallback
technologies:
  - TypeScript
  - Three.js WebGPURenderer
  - TSL
  - MeshPhysicalNodeMaterial
  - PMREM
heroImage: /media/projects/real-time-rendering-lab-cover.svg
architectureImage: /media/projects/real-time-rendering-lab-architecture.svg
architectureAlt: "材质输入、TSL 节点图、多后端 WebGPURenderer 和输出调试视图的数据流图。"
demoImage: /media/runtime/real-time-rendering-lab-runtime.png
demoImageAlt: "Material & Lighting 的真实 WebGL2 回退运行画面，使用同一套 TSL 节点材质与 PMREM 场景。"
environment:
  - "截图系统：Windows NT 10.0 x64"
  - "浏览器：Chromium 151.0.7922.34，1600×1000 CSS px，DPR 1"
  - "后端：Three.js r185 WebGPURenderer / WebGL2 fallback"
  - "图形设备：ANGLE Vulkan / SwiftShader headless capture；不代表独立显卡性能"
reproduction: "打开 Material & Lighting，切换材质、曝光、Tone Mapping 和六个 Debug View；后端标签必须与实际初始化结果一致。"
responsibilities:
  - 构建球体、地面、PMREM 房间、移动主光源、填充光、边缘光和轨道相机
  - 暴露 Base Color、Metalness、Roughness、Exposure、色调映射和六个调试视图
  - 管理实时渲染器与 Canvas 回退的生命周期
featureSlugs:
  - pbr-materials
  - tsl-node-materials
  - tone-mapping
  - direct-indirect-debug
  - webgl2-fallback
demoSlugs:
  - material-lighting
  - shadow-aa
  - frame-inspector
articleSlugs:
  - material-lighting-color-pipeline
  - shadow-temporal-aa
  - frame-inspector-observability
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
requirements:
  - label: 优先使用 WebGPU
    required: false
    capability: webgpu
  - label: WebGL2 自动渲染器回退
    required: false
    capability: webgl2
fallback:
  kind: canvas-2d
  description: Three.js 多后端渲染器失败时，继续显示程序化 Canvas 材质预览。
  image: /media/projects/real-time-rendering-lab-cover.svg
metricSource:
  kind: runtime
  description: Demo 报告当前后端和帧节奏，不发布跨设备固定 GPU 耗时。
metrics: []
architecture: Three.js WebGPURenderer 初始化 TSL 节点材质图，并在 WebGPU 不可用时内部回退 WebGL2；整个多后端渲染器失败时使用独立 Canvas 渲染器。
limitations:
  - 浏览器驱动差异会影响后端和输出精度
  - 阴影与抗锯齿管线在共享参考帧和 Frame Inspector 项目中说明
draft: false
---

## 实际运行内容

实时场景使用 `WebGPURenderer`、TSL 节点、`MeshPhysicalNodeMaterial`、PMREM 房间环境和三种光源。Base Color、Metalness、Roughness、Exposure 以及 ACES/AgX/Linear 色调映射都连接到控件；Final、Normal、Roughness、Metalness、Direct 和 Indirect 视图在同一几何与相机上切换。

Three.js 在 WebGPU 不可用时内部选择 WebGL2。如果多后端渲染器整体无法初始化，页面进入明确标注的 Canvas 2D 近似，并保留材质控件。

## 证据边界

项目验证 PBR/TSL 交互路径和后端回退行为。运行时面板报告当前后端与 animation-frame 节奏，不是通用性能基准。
