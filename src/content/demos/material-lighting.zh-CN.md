---
routeSlug: material-lighting
translationKey: material-lighting
locale: zh-CN
title: Material & Lighting Lab
summary: 检查 Three.js WebGL PBR 校准场景，并在 WebGL 初始化失败时使用明确标注的 Canvas 2D 回退。
category: rendering
renderer: Three.js WebGLRenderer + PMREM
backend: three-webgl
status: in-progress
featured: true
capabilities:
  - webgl2
requirements:
  - 优先使用 WebGL2
  - WebGL 初始化失败时使用 Canvas 2D 回退
controls:
  - Metallic
  - Roughness
  - Exposure
  - "Debug: Final / Normal / Roughness"
metrics: []
fallbackImage: /media/placeholders/demo-material-lighting.svg
relatedProjects:
  - real-time-rendering-lab
relatedArticles:
  - rhi-abstraction-boundaries
draft: false
---

## 展示内容

这个校准场景把三个实际材质控件和三个调试视图暴露出来。移动的主光源、PMREM 生成的房间环境和轨道相机都属于 Three.js WebGL 路径；回退路径是明确标注的 Canvas 程序化近似。

## 交互边界

相机和显式参数只保留在当前页面，渲染图像不会上传。页面先尝试 WebGL2，Three.js 无法初始化时再切换到 Canvas 2D。WebGPU/TSL 只是后续路线，不是当前后端；面板只报告 `requestAnimationFrame` 帧节奏，不把它表述为 GPU 计时。
