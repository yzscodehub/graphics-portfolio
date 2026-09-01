---
routeSlug: webgpu-compute-lab
translationKey: webgpu-compute-lab
locale: zh-CN
title: WebGPU Compute Lab
summary: 进行中的原生 WebGPU 实验，覆盖粒子模拟、真实三档 LOD 间接可见性与 BVH 渐进式路径追踪。
year: 2026
status: in-progress
role: 独立开发 / GPU Systems Engineer
platforms:
  - WebGPU
  - WGSL
  - Canvas 2D fallback
technologies:
  - TypeScript
  - WebGPU
  - WGSL
  - Storage Buffers
  - Timestamp Query
  - BVH
heroImage: /media/projects/webgpu-compute-lab-cover.svg
architectureImage: /media/projects/webgpu-compute-lab-architecture.svg
architectureAlt: "粒子 Ping-Pong Compute/Render 与路径追踪 CPU BVH/WGSL/HDR 累积的双通路架构图。"
demoImage: /media/runtime/webgpu-compute-lab-runtime.png
demoImageAlt: "GPU Compute Particles 在无可用 WebGPU adapter 时的真实确定性 Canvas 回退运行画面。"
environment:
  - "截图系统：Windows NT 10.0 x64"
  - "浏览器：Chromium 151.0.7922.34，1600×1000 CSS px，DPR 1"
  - "截图后端：requestAdapter 返回 null，使用明确标注的 Canvas 粒子回退"
  - "主路径要求：支持 WebGPU；timestamp-query 为可选能力"
reproduction: "在 WebGPU 浏览器中选择 25K/100K/250K 并暂停、重置、移动吸引子；无 adapter 时确认降级标签且不显示伪造 GPU 时间。"
responsibilities:
  - 管理 Ping-Pong 粒子 Buffer、生命周期重生、指针吸引子和可选 GPU 时间戳
  - 构建 median-split BVH，并上传三角形、节点和材质供路径积分使用
  - 将原生资源路径与带标签的 Canvas 回退分开
featureSlugs:
  - ping-pong-particles
  - lifecycle-respawn
  - gpu-timestamp-query
  - median-bvh
  - progressive-accumulation
demoSlugs:
  - gpu-particles
  - path-tracer
articleSlugs:
  - compute-geometry-performance
  - webgpu-particles-path-tracing
  - gpu-driven-visibility-indirect
  - bvh-progressive-path-tracing
evidence: measured
backends:
  - id: raw-webgpu
    label: Raw WebGPU + WGSL Compute/Render
    role: primary
    capabilities:
      - webgpu
  - id: canvas-2d
    label: 缩减的 Canvas 2D 回退
    role: fallback
    capabilities: []
requirements:
  - label: WebGPU
    required: false
    capability: webgpu
  - label: GPU timestamp-query（可选）
    required: false
    capability: webgpu
fallback:
  kind: canvas-2d
  description: WebGPU 不可用时，Canvas 渲染器保留粒子和路径研究的交互契约。
  image: /media/projects/webgpu-compute-lab-cover.svg
metricSource:
  kind: runtime
  description: 粒子 Compute/Render 耗时在支持 timestamp-query 时测量；其他状态只报告 animation-frame，不声称 GPU 时间。
metrics: []
architecture: 粒子使用两个 Storage Buffer 和交替读写 Bind Group；路径追踪器上传 median-BVH 节点、三角形和材质，在两个线性 rgba16float 纹理中累积并由 Display Pass 做色调映射。
limitations:
  - timestamp-query 取决于适配器，不发布跨设备固定计时数字
  - Canvas 回退保留行为，但不是等价的 GPU 测量
draft: false
---

## 实际运行内容

粒子研究在 Ping-Pong Storage Buffer 中更新位置、速度、年龄、生命周期和种子。过期粒子会确定性重生，指针移动控制吸引子，范围控件调整强度。适配器支持 timestamp-query 时，Demo 解析独立 Compute/Render 区间；不支持时明确显示 GPU 计时不可用。

路径追踪研究在 CPU 上生成小型 Cornell 风格场景，用 median split 划分三角形构建 BVH，上传节点/三角形/材质 Buffer，并通过 WebGPU Compute Pass 积分样本。交替的线性 `rgba16float` 纹理保存渐进累积，Display Pass 执行色调映射；反弹次数、Pause 和 Reset SPP 都连接到渲染器。

## 边界

Canvas 路径是兼容性预览。运行时测量会标注来源和设备能力，项目不发布固定性能承诺。
