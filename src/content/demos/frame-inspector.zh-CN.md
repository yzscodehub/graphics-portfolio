---
routeSlug: frame-inspector
translationKey: frame-inspector
locale: zh-CN
title: Frame Inspector
summary: 检查共享原生 WebGPU 参考帧中的十个真实 attachment，包含 Reference Frame 本地 Cluster Light Count、Temporal Resolve Reject Mask、真实 Pixel Probe、低频 64-bin Histogram、冻结控件和可访问 Canvas 图集回退。
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
  - HISTORY REJECT
  - CLUSTER LIGHT COUNT
  - FREEZE FRAME / RESUME FRAME
  - PIXEL PROBE
  - HISTOGRAM 64
metrics: []
metricSource:
  kind: runtime
  description: 检查器报告当前后端、attachment 格式、取值范围、最后写入者和历史状态。Pixel Probe 与 Histogram 64 对真实 GPU attachment 执行低频 readback；不发布固定性能数字。
currentLimit: Final 与 Canvas View 不支持 Readback，Cluster Heatmap 属于另一套 GPU Device；此检查器也不是完整的 RenderDoc 替代品。
fallbackImage: /media/demos/frame-inspector-poster.svg
relatedProjects:
  - engine-systems-explorer
  - real-time-rendering-lab
relatedArticles:
  - render-graph-lifetime
  - frame-inspector-observability
  - shadow-temporal-aa
  - rhi-abstraction-boundaries
  - clustered-deferred-lighting
assetIds:
  - research-courtyard
modes:
  - attachments
  - probe
referenceScene: research-courtyard
sourceUrl: https://github.com/yzscodehub/graphics-portfolio/blob/main/src/demos/frame-inspector.ts
draft: false
---

> 说明：`CLUSTER LIGHT COUNT` 是 Reference Frame 在 G-Buffer 之后写入的真实 `r8unorm` attachment。它使用同一相机和深度契约，把局部视锥量化为 8×5×8 Cluster，并统计 8 个解析代理光源的相交数量后按 8 归一化。Pixel Probe 与 Histogram 64 直接读取该纹理；它不是从独立的 Clustered / Deferred Lighting Demo 导入或共享的 GPU texture。

## 实际运行内容

原生 WebGPU 路径与 Shadow & Anti-Aliasing 研究共享参考帧，暴露十个 attachment：Final、Albedo + Metalness、Normal + Roughness、Linear Depth、Velocity、HDR Lighting、SSAO、TAA History、History Reject 和 Cluster Light Count。Reject attachment 由 Temporal Resolve 写入：白色表示无可用历史、UV bounds reject 或 depth reject，黑色表示接受了历史。Final 格式来自浏览器 preferred Canvas format；其余标签带有实际格式、范围和最后写入者。History 标明 warming、valid 或 TAA disabled 状态，并说明线性 HDR 只在显示时经过 ACES + sRGB 变换。

## 冻结与选择

选择 attachment 只改变显示视图。Freeze 会停止渲染循环并保留当前纹理供检查；Resume 允许共享帧继续推进。页面因不可见而暂停后恢复时会重置时域历史，避免跨时间断点复用。设备丢失时，页面回退到带有相同 attachment 词汇的确定性 sibling Canvas 图集。

Pixel Probe 通过显式 GPU copy/readback 读取点击位置的非 Final attachment。Histogram 64 对完整 attachment 做低频 copy，并对采样值分桶：HDR Lighting 与 TAA History 使用对数亮度，Velocity 使用缩放后的幅值。Final 与 Canvas fallback 不提供这两个操作，因为它们不暴露相同的源 attachment。

## 证据边界

这些 attachment 是参考 WebGPU 帧中的真实资源；Canvas 回退不包含生产捕获 Buffer。Cluster Heatmap 有意不在此处出现：它属于独立的 Clustered / Deferred Lighting renderer，当前尚未与这个 Reference Frame 共享 GPU device 或资源接口。本地 Cluster Light Count 是由当前 Reference Frame 自己的 Depth 与解析光源契约写入的另一条真实数据路径。检查器报告状态和来源，不把自己描述成完整 RenderDoc 替代品。
