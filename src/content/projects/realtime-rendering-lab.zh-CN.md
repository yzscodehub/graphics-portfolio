---
routeSlug: real-time-rendering-lab
translationKey: real-time-rendering-lab
locale: zh-CN
title: Real-Time Rendering Lab
summary: 一个基于 Three.js WebGL 的 PBR 材质与光照实验台，并提供 Canvas 2D 回退。
year: 2026
status: in-progress
role: 独立开发 / Rendering Engineer
platforms:
  - WebGL2
  - Canvas 2D fallback
technologies:
  - TypeScript
  - Three.js WebGLRenderer
  - MeshStandardMaterial
  - PMREM
heroImage: /media/placeholders/project-real-time-rendering-lab.svg
responsibilities:
  - 构建球体、地面、PMREM 房间环境和移动光源场景
  - 暴露 Metallic、Roughness、Exposure 及三个已实现调试视图
  - 在 WebGL 无法初始化时保留程序化 Canvas 2D 回退
featureSlugs:
  - pbr-materials
  - metalness-roughness
  - pmrem-room-environment
  - debug-view-preview
demoSlugs:
  - material-lighting
  - shadow-aa
  - frame-inspector
articleSlugs:
  - rhi-abstraction-boundaries
  - compute-geometry-performance
architecture: Three.js WebGL 路径创建 MeshStandardMaterial、PMREM 房间环境、移动主光源和轨道相机；WebGL 初始化失败时由 Canvas 2D 程序化球体接管。
metrics: []
limitations:
  - 当前材质 Demo 没有 WebGPU/TSL 路径，调试视图只有 Final、Normal 和 Roughness
  - 阴影与抗锯齿是独立的 Canvas 2D 对比 Demo，不是这个 WebGL 场景的真实管线
  - 浏览器结果不能代表所有桌面 GPU 和原生后端
draft: false
---

## 当前实现

这个实验台的重点是让材质参数和颜色链路可观察，而不是堆叠效果。Three.js WebGL 路径使用 `MeshStandardMaterial`、PMREM 房间环境、半球光、移动方向光和轨道相机；Material Demo 的控件是 Metallic、Roughness、Exposure，以及 Final、Normal、Roughness 三个视图。

## 回退与后续

当 WebGL 无法创建时，页面切换到明确标注的 Canvas 2D 程序化球体。WebGPU/TSL、真实阴影贴图和高级抗锯齿不是当前项目的后端；阴影/AA 页面目前是独立的 Canvas 视觉对比，后续再接入真实 WebGL/GLSL 管线。
