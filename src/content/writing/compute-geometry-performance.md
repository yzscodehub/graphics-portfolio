---
translationKey: compute-geometry-performance
routeSlug: compute-geometry-performance
locale: zh-CN
title: Compute Shader 大规模几何处理与性能测量
description: 用数据布局、工作组、间接绘制和同步边界分析 GPU 几何处理的性能，而不是只看粒子数量。
category: gpu-performance
tags:
  - Compute Shader
  - GPU Performance
  - Geometry
readingMinutes: 10
relatedProject: webgpu-compute-lab
relatedDemo: gpu-particles
englishTitle: Large-Scale Geometry Processing with Compute Shaders
englishDescription: Analyze GPU geometry work through data layout, workgroups, indirect drawing, and synchronization instead of particle counts alone.
publishedAt: 2026-08-30
updatedAt: 2026-08-30
draft: false
---

## 数量不是性能指标

“一次更新一百万个粒子”听起来很有说服力，但它没有说明每个粒子读取多少字节、做多少算术、是否发生分支、结果是否需要回读，以及渲染阶段是否成为瓶颈。Compute Shader 的优化起点应是工作负载模型：带宽受限、算力受限、占用率受限，还是被同步和提交开销限制。

本文用几何处理和粒子更新作例子，重点讨论如何建立可重复的测量方法。

## 先确定数据布局

AoS（Array of Structures）让一个粒子的属性相邻，适合一起读取完整状态；SoA（Structure of Arrays）则让只需要位置的阶段可以连续读取位置数组，减少无用带宽。没有绝对正确的布局，关键在于访问模式是否匹配。

```text
AoS: position velocity life color | position velocity life color | ...
SoA: positions... | velocities... | lifes... | colors...
```

如果 Compute 只更新位置和速度，却把颜色、材质和生命周期一起搬运，带宽成本会被放大。另一方面，过度拆分 Buffer 也可能增加绑定和调度复杂度。应先记录实际读取字段，再决定是否拆分。

## 工作组与边界

WGSL 中的 `workgroup_size` 决定每个 Dispatch 的线程组织，但它不是越大越好。需要考虑设备的工作组上限、寄存器和共享内存占用，以及输入长度不是工作组整数倍时的边界检查。

```wgsl
@compute @workgroup_size(128)
fn update(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= particleCount) {
    return;
  }
  // Read state[index], write nextState[index].
}
```

边界检查是正确性要求，不是“理想输入下可以省略的优化”。粒子数量动态变化、质量等级切换或缓冲容量对齐都可能让最后一个工作组包含越界线程。

## Ping-Pong 与间接绘制

同一个 Dispatch 内不能安全地让线程读写同一份状态，除非算法和同步语义明确允许。最简单且容易解释的方案是 Ping-Pong Buffer：本帧从 `stateA` 读、向 `stateB` 写，下一帧交换引用。

当粒子数量或实例数量由 GPU 决定时，可以把计数写入 Indirect Buffer，让 DrawIndirect 消费它。这样减少 CPU 读取和重新提交，但也带来额外的计数初始化、Buffer 用途声明和跨 Pass 同步要求。只有在 CPU 回读确实是瓶颈时，间接绘制才有意义。

## 把同步当作成本

Compute 写入 Buffer 后，Render Pass 读取它，至少要有可见性和阶段上的先后关系。WebGPU 帮助验证资源使用，但开发者仍要准确声明 Storage、Vertex、Indirect 等用途。原生后端则可能需要更显式的状态或屏障。

真正昂贵的往往不是一条指令，而是为了读取结果而让 CPU 等待 GPU，或者每个小批次都提交一次命令。保持数据留在 GPU、合并兼容工作、按帧组织命令，通常比微调一个乘法更值得先做。

## 测量方法

不要只使用浏览器总帧率。至少记录：

- GPU Compute 阶段的时间（若平台提供时间戳查询）；
- Render 阶段时间；
- CPU 录制和提交时间；
- Buffer 大小与每帧写入量；
- 设备、后端、分辨率和质量等级。

如果没有可靠的 GPU 时间戳，就明确显示“总帧时间”或“浏览器测量”，而不是将 RAF 间隔当成 Compute 时间。测量时预热资源创建，排除第一次管线编译的尖峰；同时重复运行并记录稳定区间，而不是挑一帧最好看的数字。

## 质量等级应保持语义一致

低、中、高质量可以调整粒子数量、积分步长、噪声采样或渲染分辨率，但每一档都应保持同一种物理更新含义。把高质量模式改成另一套算法，会让对比失去意义。移动端默认低质量不是“移动端不重要”，而是明确资源预算后仍让 Demo 可用。

## 从结果回到代码

当测量显示 Compute 占用主要时间，再看内存访问是否连续、是否重复读取常量、工作组是否因为寄存器压力降低占用率。当 Compute 很快但总帧慢，应该检查顶点扩展、透明混合、带宽和合成，而不是继续优化 Compute。若 CPU 提交占主导，则考虑合并命令、复用绑定和间接绘制。

性能报告必须带上下文。本文不提供跨设备的固定 FPS 承诺；可公开的 Demo 只显示访客设备实时测量的数据和配置。一个可复现、能解释限制的测量，比一个缺少设备信息的漂亮数字更有工程价值。
