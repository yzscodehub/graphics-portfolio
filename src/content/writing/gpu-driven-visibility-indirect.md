---
routeSlug: gpu-driven-visibility-indirect
translationKey: gpu-driven-visibility-indirect
locale: zh-CN
title: GPU-Driven Visibility：Culling、Compaction、LOD 与 Indirect Draw
description: 从 CPU 提交全部实例的基线开始，构建 Compute Frustum Culling、可见实例压缩、LOD 选择和 GPU 写入 Indirect Command 的完整数据路径。
module: gpu-compute
moduleOrder: 3
articleOrder: 3
level: advanced
tags:
  - GPU Driven
  - Indirect Draw
  - Frustum Culling
  - LOD
prerequisites:
  - 了解 Vertex/Index/Storage Buffer 和 Compute Dispatch
  - 理解视锥平面、Bounding Sphere 与实例化绘制
learningOutcomes:
  - 能描述 CPU-submitted 与 GPU-driven 实例路径的差异
  - 能实现确定性的 Frustum Culling、Compaction 和 LOD 输出
  - 能验证 Indirect Command、Visible Count 和测量来源
relatedProjects:
  - webgpu-compute-lab
relatedDemos:
  - gpu-particles
relatedArticles:
  - compute-geometry-performance
  - webgpu-particles-path-tracing
  - render-graph-lifetime
englishTitle: "GPU-Driven Visibility: Culling, Compaction, LOD, and Indirect Draw"
englishDescription: Build a verifiable GPU-driven instance path from CPU-submitted baseline through compute culling, compacted visible lists, LOD selection, and indirect commands.
publishedAt: 2026-08-31
updatedAt: 2026-08-31
draft: false
---

GPU-driven rendering 的重点不是“把更多代码放进 Compute Shader”，而是改变提交边界：CPU 不再逐对象决定是否绘制和调用多少次 Draw，而是上传稳定的场景描述，由 GPU 生成当帧可见实例列表、LOD 选择和 Indirect Command。只有当这条数据路径可以被读回、对照和测量时，它才是系统能力，而不是一个数量更大的粒子效果。

站内 Demo 保留 Particles 作为 `Simulation` 模式，因为 Ping-Pong Storage Buffer 能清楚展示 Compute 写、Vertex 读和资源生命周期；新增的 `Visibility` 模式则使用 Research Courtyard 的实例资源，证明 Culling 与 Indirect Draw。两个模式共享 Runtime、Timestamp、Pause/Resume 和 Device Lost 契约，但不混用指标。

## CPU-Submitted Baseline 必须存在

Baseline 使用 CPU 计算每个实例的 Bounding Sphere 与视锥关系，再将可见 Transform 写入动态 Buffer，最后执行固定实例数 Draw。它的价值不是追求最慢，而是提供可解释对照：

```text
all instances
→ CPU frustum test
→ visible transforms upload
→ drawIndexed(visibleCount)
```

Baseline 需要报告 Tested、Visible、Uploaded Bytes 和 CPU Culling Time。若只比较 FPS，就无法判断改进来自减少 Draw Work、减少 Upload，还是两个模式使用了不同画质。

## Packed Instance 与 Bounding Sphere

实例记录固定为 64-byte 对齐，包含 3×4 Transform、Mesh ID、Material Override、Bounding Sphere 和状态位。Mesh 的局部 Bounding Sphere 由离线 Packed Scene Compiler 生成；运行时根据 Instance Transform 计算世界空间中心和最大缩放半径。

```ts
interface PackedInstance {
  transform: Float32Array; // 3x4, 48 bytes
  meshId: number;
  materialId: number;
  boundsRadius: number;
  flags: number;
}
```

非均匀缩放使用三个轴长度中的最大值扩大半径，宁可产生保守可见，也不能因为低估 Bounds 错误裁剪。NaN、负半径或越界 Mesh ID 在上传前直接拒绝。

## Frustum Culling 的 CPU/GPU 共用约定

相机视锥转换为六个归一化平面。Sphere 对每个平面执行：

```wgsl
fn sphereInsidePlane(center: vec3f, radius: f32, plane: vec4f) -> bool {
  return dot(plane.xyz, center) + plane.w >= -radius;
}
```

CPU 参考实现和 WGSL 必须使用相同 Matrix Convention、Plane 顺序和边界比较。测试场景包含完全可见、完全不可见、与近平面相切、跨越边界和非均匀缩放实例。GPU 输出不要求与 CPU 写入顺序一致，但可见 Instance ID 集合必须一致。

第一版只实现 Frustum Culling，不在核心验收中加入 Hi-Z Occlusion。这样可以先把几何输入、Bounds、Compaction 和 Indirect Command 做成闭环，再将 Occlusion 作为后续 Lab。

## Compaction 不能依赖不稳定猜测

最小实现使用 Atomic Counter：可见线程执行 `atomicAdd` 获得输出位置并写入 Visible Instance Buffer。它简单、易验证，但输出顺序不稳定，且高可见率时会集中访问一个 Counter。

```wgsl
if (isVisible(instance, frustum)) {
  let outputIndex = atomicAdd(&counters.visible, 1u);
  visibleInstances[outputIndex] = buildVisibleInstance(instance, selectedLod);
}
```

本轮不要求实现完整 Prefix Sum；文章和 UI 只能把当前路径称为 Atomic Compaction。未来若加入 Scan，应作为独立模式并比较 Counter Contention、Dispatch 数与额外 Buffer。

Visible Count Buffer 同时作为证据来源和 Indirect Command 输入。Readback 只按低频率执行，不能每帧阻塞 GPU 等待映射。

## LOD 必须由屏幕误差驱动

固定距离阈值容易在 FOV 或分辨率变化时失真。Packed Scene 为每个 LOD 保存三角形数量和离线归一化误差；运行时把误差转换到像素尺度：

```text
pixelScale = viewportHeight / (2 × tan(fovY / 2))
projectedError = lodError × pixelScale / distance
```

选择满足误差阈值的最粗 LOD，并在 UI 中显示 LOD0/LOD1/LOD2 数量。当前 Research Courtyard Props 至少生成三档 LOD，三角形数量必须严格下降；如果简化工具无法达到目标，Manifest 必须记录真实数量，不能伪造 50%/25%。

## Indirect Command 是公开数据结构

WebGPU Indexed Indirect Command 使用五个 `uint32`：

```text
indexCount
instanceCount
firstIndex
baseVertex
firstInstance
```

本轮将 Command 放在 32-byte 对齐 Slot 中，并固定 `firstInstance = 0`，避免依赖可选的 `indirect-first-instance` Feature。Compute Pass 写入 `instanceCount`，Render Pass 使用 `drawIndexedIndirect` 消费；测试通过低频 Readback 验证字段和值域。

每个 Mesh/LOD 拥有独立 Command Slot。空列表必须产生 `instanceCount = 0`，而不是执行带陈旧 Count 的上一帧命令。Camera Revision、Instance Count 或 Scene Revision 变化时，Counter 和 Command 都在新一帧 Compute 中重建。

## Simulation 与 Visibility 指标不能混用

Simulation 模式报告 Particle Count、Compute Time 和 Render Time；Visibility 模式报告 Tested、Visible、Submitted、LOD Distribution、Command Count 和 Culling/Render Time。两种模式可以共用 `timestamp-query`，但 UI 标签和 Metric Source 必须不同。

没有 Timestamp 时：

- 可以报告 CPU Encode 或 RAF Cadence；
- 可以报告 GPU Buffer 中的数量；
- 不得把 RAF 间隔写成 GPU Culling Time；
- 不得宣称 Indirect 一定比 Baseline 快。

性能结论只在相同 Research Courtyard、相同相机、相同 Render Size 和相同可见输出下成立。

## 可复现实验

1. Visibility 模式选择 100K Instances；
2. 固定相机，记录 Tested、Visible 和各 LOD 数量；
3. 切换 CPU Baseline 与 GPU-Driven，确认 Final 与 Visible ID 集合一致；
4. 将相机转向空区域，确认 Indirect `instanceCount` 降到 0；
5. 修改 FOV，确认 LOD 根据屏幕误差变化；
6. 禁用 Timestamp，确认 GPU 时间显示为 N/A；
7. 模拟 Resize、后台恢复和 Device Lost，确认旧 Buffer 与旧 Command 不继续提交。

实验通过条件是数据一致、资源生命周期关闭和指标来源真实，而不是某一帧出现更高 FPS。

## 当前边界

本轮不实现 Hi-Z Occlusion、Mesh Shader、Meshlet Rasterization、Multi-Draw Indirect、GPU Sort、Streaming Residency 或通用场景编辑器。Atomic Compaction 的顺序不稳定，不应被依赖为 Instance ID 排序。移动端继续使用 Poster/Canvas Fallback，不运行 100K Instance 高负载路径。

## 参考资料

- [WebGPU Specification](https://www.w3.org/TR/webgpu/)
- [Three.js WebGPU Draw Indirect](https://github.com/mrdoob/three.js/blob/dev/examples/webgpu_struct_drawindirect.html)
- [meshoptimizer](https://github.com/zeux/meshoptimizer)
- [WebGPU Bundle Culling](https://github.com/toji/webgpu-bundle-culling)
