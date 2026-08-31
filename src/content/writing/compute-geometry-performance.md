---
translationKey: compute-geometry-performance
routeSlug: compute-geometry-performance
locale: zh-CN
title: Compute Shader 大规模几何处理与性能测量
description: 用数据布局、工作组、间接绘制和同步边界分析 GPU 几何处理的性能，而不是只看粒子数量。
module: gpu-compute
moduleOrder: 3
articleOrder: 1
level: advanced
tags:
  - Compute Shader
  - GPU Performance
  - Geometry
prerequisites:
  - 了解 GPU Buffer、线程组和 Dispatch
  - 熟悉基本性能分析与帧时间概念
learningOutcomes:
  - 能为每粒子更新建立带宽和算术工作负载模型
  - 能解释 Ping-Pong Buffer 的读写所有权与同步边界
  - 能区分 GPU timestamp、CPU 编码和 RAF cadence
relatedProjects:
  - webgpu-compute-lab
relatedDemos:
  - gpu-particles
relatedArticles:
  - webgpu-particles-path-tracing
  - bvh-progressive-path-tracing
  - rhi-abstraction-boundaries
englishTitle: Large-Scale Geometry Processing with Compute Shaders
englishDescription: Analyze GPU geometry work through data layout, workgroups, indirect drawing, and synchronization instead of particle counts alone.
publishedAt: 2026-08-30
updatedAt: 2026-08-31
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
@compute @workgroup_size(64)
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

当前 GPU Compute Particles Demo 使用固定 preset 对应的直接 `draw(count)`，没有实现 GPU culling 或 indirect draw。这里把间接绘制作为下一阶段设计边界，而不是已经验证的功能。

## 把同步当作成本

Compute 写入 Buffer 后，Render Pass 读取它，至少要有可见性和阶段上的先后关系。WebGPU 帮助验证资源使用，但开发者仍要准确声明 Storage、Vertex、Indirect 等用途。原生后端则可能需要更显式的状态或屏障。

真正昂贵的往往不是一条指令，而是为了读取结果而让 CPU 等待 GPU，或者每个小批次都提交一次命令。保持数据留在 GPU、合并兼容工作、按帧组织命令，通常比微调一个乘法更值得先做。

## 建立每粒子的工作负载模型

优化之前先写出每个粒子的状态。当前实验用八个 `float32`：位置二维、速度二维、age、lifetime、seed 和 padding，总计 32 bytes。Ping-Pong 更新至少读取一份旧状态并写一份新状态，因此仅状态流量的理论下界是每粒子每帧 64 bytes，尚未计算 Uniform、命令和 Render 读取。

```text
25K  particles → 1.6 MB/frame state read+write lower bound
100K particles → 6.4 MB/frame
250K particles → 16.0 MB/frame
```

这些数值只是由结构大小推导的流量下界，不是设备实测带宽。若 Shader 额外读取随机表、邻域或多次写入，真实流量会更高；缓存也可能减少外部内存访问。模型的作用是解释趋势，并帮助识别“算法很简单但仍被带宽限制”的情况。

算术侧可以列出主要操作：吸引子方向、距离衰减、速度积分、位置积分、age 更新、越界/过期判断和重生。若以后加入碰撞或邻域搜索，算术和访问模式都会改变，不能再把新结果与当前基线直接比较。

## 一帧中的所有权流

```text
CPU controls / pointer
  → uniform buffer

state A --read--> Compute --write--> state B
                                    ↓
                              Render Pass / points
                                    ↓
                                  Present

next frame: swap A and B
```

Bind Group 预先为 A→B 和 B→A 两种方向建立，帧循环只选择其中一组。这样避免每帧重建绑定，也让读写角色清楚。Reset 会重新上传确定性 seed 数据；Pause 会取消 RAF，不再提交 Compute 或 Render，而不是继续用 `dt = 0` 消耗 GPU。

指针坐标必须从 CSS 像素转换到 Canvas/场景约定。强度控制只影响吸引加速度，不改变粒子数或积分规则，因此不同强度仍可在同一工作负载模型下比较。

## 生命周期不变量

每个粒子满足：

- `0 <= age < lifetime` 时继续积分；
- 过期或越界时重生；
- lifetime 始终大于零；
- 位置、速度和 age 必须保持有限值；
- 重合在 attractor 上时，归一化方向返回零而不是 NaN。

最后一项很容易被忽略。WGSL 的 `normalize(vec2(0))` 可能产生非有限值，而 NaN 一旦写入 Ping-Pong Buffer 会在后续帧持续传播。当前 Shader 先检查距离，再选择零方向；CPU 参考测试也覆盖奇点。

## Timestamp Query 的正确使用边界

当 adapter 提供 `timestamp-query` 时，可以在 Compute 和 Render 区间写时间戳，resolve 到 Query Buffer，再异步 map readback。时间来源应显示为 `gpu-timestamp-query`，并把 Compute 与 Render 分开。

几个约束必须保留：

1. Query feature 不存在时显示 N/A，不用 RAF 冒充；
2. 不在刚提交后立刻同步等待 map，否则测量本身会串行化帧；
3. 使用 readback ring，读取更早的已完成帧；
4. Pipeline 编译、Buffer 创建和第一次提交不进入稳定样本；
5. 记录 adapter、浏览器、分辨率和粒子 preset。

RAF cadence 仍有价值，它描述用户看到的节奏，但它包含浏览器调度、合成和显示同步，不能回答某个 GPU Pass 的耗时。

## 常见失败模式

| 失败             | 观察信号               | 处理方向                             |
| ---------------- | ---------------------- | ------------------------------------ |
| A/B 角色没有交换 | 粒子停在首帧或隔帧跳变 | 检查 bind group index 与 draw source |
| 原地读写竞争     | 同一配置结果不稳定     | 分离输入输出或证明同步算法           |
| `dt` 过大        | 恢复标签页后粒子飞出   | clamp dt 或重置积分状态              |
| attractor 奇点   | 少量 NaN 最终污染全屏  | 零长度保护与有限值测试               |
| workgroup 越界   | 尾部粒子随机损坏       | 对 `id >= count` fail fast           |
| 每帧 map Buffer  | CPU/GPU 强制串行       | 只对异步 readback ring map           |
| timestamp 不支持 | 面板仍显示 GPU ms      | 明确 N/A 和 metric source            |
| Alpha 点混合过重 | Compute 很快但总帧慢   | 分开测 Render、overdraw 与合成       |

## 25K / 100K / 250K 可复现实验

对每个 preset 使用相同分辨率、吸引子轨迹和质量等级：

1. 初始化后丢弃 Pipeline 编译和资源上传阶段；
2. 预热固定帧数；
3. 记录 Compute GPU timestamp（若支持）、Render GPU timestamp 和 RAF cadence；
4. 同时记录每帧理论状态流量；
5. 分别执行静止 attractor、移动 attractor、集中重生三种负载；
6. Pause 后确认 GPU Query 不再增长；
7. Reset 后确认 seed 与生命周期不变量可复现；
8. 报告 P50/P95 时注明它们属于当前设备本次运行，不写成站点常量。

如果 Compute 时间接近线性增长而 Render 突然放大，问题更可能是点大小、透明混合或 overdraw；若两者都很低但 RAF 不稳定，则继续看浏览器调度和合成。测量的目的不是证明“250K 很快”，而是把瓶颈归到可行动的阶段。

## 当前实现与下一步

当前实现验证了固定数量的 Ping-Pong Storage Buffer、生命周期重生、吸引子、暂停/重置和可选 timestamp-query。25K、100K 与 250K 只改变状态数量，不替换积分算法；移动端 Canvas 回退则明确属于另一条缩减路径，不能与 WebGPU preset 混作同一性能曲线。当前实现没有 GPU-driven culling、prefix sum、compaction 或 indirect draw，也没有把粒子扩展成复杂网格。下一步只有在测量证明 CPU count 或无效粒子 Draw 成为瓶颈时，才应加入 GPU count 与 indirect path；否则只是增加同步和调试成本。

## 参考资料

- [WebGPU Specification](https://www.w3.org/TR/webgpu/)
- [WebGPU Shading Language Specification](https://www.w3.org/TR/WGSL/)
- [WebGPU Timestamp Queries](https://www.w3.org/TR/webgpu/#timestamp-queries)
