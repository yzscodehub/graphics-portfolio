---
routeSlug: clustered-deferred-lighting
translationKey: clustered-deferred-lighting
locale: zh-CN
title: 从 G-Buffer 到 Cluster Light List：Deferred 与 Clustered Lighting
description: 以同一 Research Courtyard 为基线，拆解 Naive Forward、Deferred 与 Clustered Lighting 的数据流、Cluster 构建、Light List、溢出处理和可验证测量。
module: rendering
moduleOrder: 1
articleOrder: 3
level: advanced
tags:
  - Deferred Rendering
  - Clustered Lighting
  - GBuffer
  - WebGPU
prerequisites:
  - 理解 Render Pass、深度缓冲与相机投影
  - 了解 Storage Buffer 和 Compute Shader
learningOutcomes:
  - 能解释 Forward、Deferred 和 Clustered 三条路径的数据与复杂度差异
  - 能实现视锥 Cluster、Light Bounds 和有界 Light List
  - 能区分 GPU Timestamp、CPU 编码时间和画面帧率
relatedProjects:
  - real-time-rendering-lab
relatedDemos:
  - clustered-lighting
  - frame-inspector
relatedArticles:
  - material-lighting-color-pipeline
  - shadow-temporal-aa
  - frame-inspector-observability
englishTitle: "From G-Buffer to Cluster Light Lists: Deferred and Clustered Lighting"
englishDescription: A shared-scene study of Forward, Deferred, and Clustered Lighting, including frustum clusters, bounded light lists, overflow, intermediate buffers, and honest timing.
publishedAt: 2026-08-31
updatedAt: 2026-08-31
draft: false
---

实时多光源渲染真正困难的部分，不是把一盏 Point Light 写进 Shader，而是控制“哪些灯需要被哪些像素计算”。如果每个像素遍历所有灯，复杂度会随屏幕覆盖和灯光数量一起增长；如果先把几何写入 G-Buffer，再做全屏光照，几何复杂度与光照复杂度可以分离，但带宽和附件生命周期成为新的主要成本；Clustered Lighting 则继续利用空间局部性，把灯光列表限制到一个三维视锥单元。

这三个方案不应在三个不同场景里比较。相机、材质、灯光动画、曝光和输出变换必须保持一致，否则所谓性能或画质差异无法归因。站内 Demo 因此使用同一个 Research Courtyard，并把模式选择看作渲染路径切换，而不是换一段预录视频。

## Naive Forward 是必要的 Baseline

Naive Forward 对每个可见物体执行光照，并在 Fragment Shader 中遍历当前场景的全部动态光。它不是推荐的最终方案，却是不可缺失的基线：如果没有它，Clustered 模式只能证明“另一段代码能够运行”，不能证明 Light List 是否减少了无关工作。

一个最小 Baseline 的核心近似如下：

```wgsl
var radiance = vec3f(0.0);
for (var lightIndex = 0u; lightIndex < uniforms.lightCount; lightIndex++) {
  radiance += evaluatePointLight(lights[lightIndex], worldPosition, normal, material);
}
```

该循环的成本取决于屏幕上被覆盖的像素数量和灯光总数。即使某盏灯位于另一层房间，像素仍会读取并排除它。Baseline 页面必须显示 Submitted Lights，而不是只显示 FPS；只有这样，访客才能看到算法输入规模。

## Deferred 将几何与光照拆成两个阶段

Deferred 的 Geometry Pass 写入可重建光照输入的附件。本项目固定采用：

| Attachment         | Format         | 内容                        |
| ------------------ | -------------- | --------------------------- |
| Albedo + Metalness | `rgba8unorm`   | RGB Base Color，A Metalness |
| Normal + Roughness | `rgba16float`  | World Normal 与 Roughness   |
| Linear Depth       | `r32float`     | 归一化 View Distance        |
| Device Depth       | `depth32float` | 深度测试与位置重建          |

Lighting Pass 从深度重建世界位置，再读取材质参数。这样每个不透明像素只执行一次主要光照，但会增加 MRT 写入、纹理读取和显存带宽。透明或 Alpha Mask 物体也不能简单地进入同一延迟路径；Research Courtyard 的 Chainlink Fence 因而放在独立 Forward Alpha-Mask Pass 中，并明确记录 Last Writer。

Deferred 并不自动解决“每像素遍历所有灯”的问题。它只是提供了稳定的屏幕空间输入，让 Tiled 或 Clustered Light Culling 更容易组合。

## Cluster Grid 如何覆盖视锥

屏幕被切成固定 Tile，深度方向按对数或近似对数分层。当前教学范围使用确定性网格：

```text
X = ceil(renderWidth  / tileWidth)
Y = ceil(renderHeight / tileHeight)
Z = depthSlices
clusterCount = X × Y × Z
```

给定 Pixel Coordinate 与 Linear Depth，可以得到 Cluster Index：

```wgsl
let tile = vec2u(position.xy) / uniforms.tileSize;
let depthSlice = depthToSlice(linearDepth, uniforms.near, uniforms.far);
let clusterIndex = tile.x + tile.y * uniforms.clusterCount.x
  + depthSlice * uniforms.clusterCount.x * uniforms.clusterCount.y;
```

Near/Far、Tile Size、Depth Slice 函数必须同时被 CPU 参考实现、Raw WebGPU Compute assignment 和 Fragment Shader 使用。当前版本由 GPU Compute 写入 fixed-offset packed light list，Fragment Shader 以相同的 cluster index 约定读取它；CPU 只在低频 64-light readback 时做对照验证。任何一处采用不同的边界或取整规则，都会产生难以复现的灯光闪烁。因此这些参数属于公共契约，而不是 Shader 内部常量。

## Light Assignment、容量与 Overflow

每盏 Point Light 先转换到 View Space，计算它影响的屏幕 Tile 与 Depth Slice 范围，再写入对应 Cluster 的 Light List。教学实现采用固定容量列表，使失败能够被观察：

```text
ClusterHeader { offset, count }
ClusterLightIndices[MAX_CLUSTER_LIGHTS]
OverflowCounter
```

固定容量不是生产系统的唯一选择，但它提供明确的不变量：`count` 不得超过上限；被丢弃的 Light 必须增加 Overflow；UI 必须显示最大 Occupancy 和 Overflow，而不是静默截断。当 512 盏灯的预设产生 Overflow 时，验收应失败或主动降低 Grid/Light Radius，而不是继续展示看似正常的画面。

GPU Compute 实际构建 64、256、512 灯光预设的 fixed-offset Light List，并写入 Cluster Header count、Light Indices 与 Overflow Counter。CPU 参考实现只在低频 64-light readback 时验证 Light Bounds、Cluster Index、集合成员与 Overflow；它不替代 GPU assignment，也不把未完成的真实硬件验收冒充为性能结论。

## 三种视图证明三种问题

Final 只回答“画面能否显示”，不足以证明 Clustered Lighting。Demo 还必须提供：

- G-Buffer：证明 Deferred 输入来自真实 Geometry Pass；
- Depth Slice：证明 Z 分层与当前深度一致；
- Cluster Heatmap：显示每个 Cluster 的 Light Count；
- Overflow 状态：证明列表容量和失败路径可见；
- Naive/Deferred/Clustered 切换：证明相同场景使用不同执行计划。

热力图只是一种 Display Transform，不能回写 Cluster Buffer，也不能被描述成线性 HDR 结果。它只属于本 Demo 自己的 renderer；Frame Inspector 当前使用独立 Reference Frame，没有共享 GPU device、texture 或 frame state，因此不显示或声称显示这个 Heatmap。

## 测量必须绑定工作量

可用 `timestamp-query` 时，当前实现报告真实 Geometry、Compute assignment 与 Lighting GPU pass 时间；CPU reference 对照的成本单独标注。不可用时，UI 不显示 GPU 时间，只显示低频 GPU overflow readback、CPU reference verification 与明确的 timestamp unavailable 状态，不把 RAF cadence 冒充为 GPU 时间。FPS 不能代替工作量数据。

每次记录还需要包含：

```text
render size / DPR
mode
light count
cluster dimensions
non-empty clusters
maximum occupancy
overflow
GPU timestamp availability
browser / adapter
```

高端参考验收为 RTX 4070 级别、1080p、DPR 1.0。该环境只定义站内质量档位，不等于对所有设备承诺相同帧率。

## 可复现实验

1. 固定 Research Courtyard 相机和 256 灯光；
2. 分别运行 Naive、Deferred、Clustered；
3. 冻结灯光动画，比较 Final 输出是否在容差内一致；
4. 打开 Depth Slice 和 Cluster Heatmap；
5. 将灯光提高到 512，检查 Overflow 仍为 0；
6. 关闭 `timestamp-query`，确认 UI 不再显示 GPU 时间；
7. 切换到 Canvas Fallback，确认它明确标记为静态或近似结果。

实验的目标不是寻找一张最好看的截图，而是证明输入、分桶、列表、输出和测量来源形成闭环。

## 当前边界

本轮不实现 Hi-Z Occlusion、Meshlet、Shadow Atlas、透明物体的 Clustered Forward、Probe GI、SSR/SSGI 或通用 glTF 编辑器。当前运行时使用自制程序化 Research Courtyard；独立审计的 CC0 asset manifest 仅为后续 packed-scene 路径预留接口，原始 4K/8K 资产不属于网站运行时。Clustered 模式的性能收益也只在相同场景、相同灯光和相同输出条件下成立。

## 参考资料

- [WebGPU Specification](https://www.w3.org/TR/webgpu/)
- [WebGPU Clustered Forward Shading](https://github.com/toji/webgpu-clustered-shading)
- [Clustered Deferred and Forward Shading](https://www.cse.chalmers.se/~uffe/clustered_shading_preprint.pdf)
- [WebGPU Sponza Demo](https://github.com/gnikoloff/webgpu-sponza-demo)
