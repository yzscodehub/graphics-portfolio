---
routeSlug: shadow-aa
translationKey: shadow-aa
locale: zh-CN
title: Shadow & Anti-Aliasing Lab
summary: 使用共享的原生 WebGPU 参考帧比较阴影、G-Buffer、深度、速度和时间历史路径，并提供 Canvas 回退。
category: rendering
renderer: Raw WebGPU 参考帧 / Canvas 2D 回退
backend: raw-webgpu
status: completed
maturity: completed
evidence: verified
backends:
  - id: raw-webgpu
    label: 共享原生 WebGPU 参考帧
    role: primary
    capabilities:
      - webgpu
  - id: canvas-2d
    label: 带标签的 Canvas 2D 对比
    role: fallback
    capabilities: []
capabilities:
  - webgpu
requirements:
  - label: WebGPU
    required: false
    capability: webgpu
  - label: Canvas 2D 回退
    required: false
fallback:
  kind: canvas-2d
  description: 原生参考帧无法初始化时，使用带标签的 Canvas 对比保留阴影柔化和历史控件。
  image: /media/demos/shadow-aa-poster.svg
controls:
  - SHADOW HARD
  - SHADOW PCF
  - SHADOW PCSS
  - AA NONE
  - AA FXAA
  - AA TAA
  - RESET HISTORY
metrics: []
metricSource:
  kind: runtime
  description: 实时渲染器报告后端和选择的模式，不发布跨设备固定 GPU 性能数字。
fallbackImage: /media/demos/shadow-aa-poster.svg
relatedProjects:
  - real-time-rendering-lab
relatedArticles:
  - shadow-temporal-aa
  - frame-inspector-observability
draft: false
---

## 实际运行内容

原生 WebGPU 参考帧在同一帧中编码阴影图、多目标 G-Buffer、线性深度、速度、HDR 光照、SSAO 和时间 resolve 历史。Hard、PCF、PCSS 选择已实现的阴影着色器分支，None、FXAA、TAA 选择对应的 resolve 路径。

## 时间行为

TAA 使用当前/上一帧世界点投影得到的 UV Velocity、Halton 抖动和上一帧深度。重投影坐标在 clamp 前执行 bounds reject，再进行深度拒绝与邻域裁剪。改变阴影模式、抗锯齿模式、场景版本、点击 Reset History 或从页面暂停恢复，都会使历史失效。Frame Inspector 提供 Freeze，通过冻结当前帧检查相同的 attachment 家族。

## 回退边界

WebGPU 无法初始化或设备丢失时，页面切换到明确标注的 Canvas 对比。回退保留模式名称和重置行为，但不替代原生 G-Buffer 实现。
