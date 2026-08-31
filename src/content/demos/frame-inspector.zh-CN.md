---
routeSlug: frame-inspector
translationKey: frame-inspector
locale: zh-CN
title: Frame Inspector
summary: 检查共享原生 WebGPU 参考帧中的八个真实 attachment，并提供可访问 Canvas 图集回退和冻结控件。
category: engine
renderer: Raw WebGPU attachments / Canvas 2D 图集回退
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
    label: 确定性 Canvas 2D attachment 图集
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
  description: 共享 WebGPU 参考帧无法初始化时，仍显示确定性的 attachment 图集。
  image: /media/demos/frame-inspector-poster.svg
controls:
  - FINAL
  - ALBEDO + METALNESS
  - NORMAL + ROUGHNESS
  - LINEAR DEPTH
  - VELOCITY
  - HDR LIGHTING
  - SSAO
  - TAA HISTORY
  - FREEZE FRAME / RESUME FRAME
metrics: []
metricSource:
  kind: runtime
  description: 检查器报告当前后端、attachment 格式、取值范围和最后写入者，不发布固定性能数字。
fallbackImage: /media/demos/frame-inspector-poster.svg
relatedProjects:
  - engine-systems-explorer
  - real-time-rendering-lab
relatedArticles:
  - render-graph-lifetime
  - frame-inspector-observability
  - shadow-temporal-aa
  - rhi-abstraction-boundaries
draft: false
---

## 实际运行内容

原生 WebGPU 路径与 Shadow & Anti-Aliasing 研究共享参考帧，暴露八个 attachment：Final、Albedo + Metalness、Normal + Roughness、Linear Depth、Velocity、HDR Lighting、SSAO 和 TAA History。Final 格式来自浏览器 preferred Canvas format；其余标签带有实际格式、范围和最后写入者。History 标明 warming/valid 状态，并说明线性 HDR 只在显示时经过 ACES + sRGB 变换。

## 冻结与选择

选择 attachment 只改变显示视图。Freeze 会停止渲染循环并保留当前纹理供检查；Resume 允许共享帧继续推进。页面因不可见而暂停后恢复时会重置时域历史，避免跨时间断点复用。设备丢失时，页面回退到带有相同 attachment 词汇的确定性 sibling Canvas 图集。

## 证据边界

这些 attachment 是参考 WebGPU 帧中的真实资源；Canvas 回退不包含生产捕获 Buffer。检查器报告状态和来源，不把自己描述成完整 RenderDoc 替代品。
