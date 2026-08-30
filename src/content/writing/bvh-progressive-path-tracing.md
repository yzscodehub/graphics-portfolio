---
translationKey: bvh-progressive-path-tracing
routeSlug: bvh-progressive-path-tracing
locale: zh-CN
title: WebGPU 路径追踪器：BVH、材质散射与线性累积
description: 从 CPU median-split BVH 到 WGSL 遍历、Diffuse/Metal/Dielectric、矩形光源采样、rgba16float 累积和独立 Tone Map，拆解一个可验证的渐进式路径追踪器。
category: rendering
module: ray-tracing
moduleOrder: 4
articleOrder: 1
level: advanced
tags:
  - Path Tracing
  - BVH
  - Monte Carlo
  - WebGPU
readingMinutes: 20
prerequisites:
  - 理解射线与三角形求交
  - 了解概率采样、期望和线性颜色空间
  - 熟悉 WebGPU Buffer、Compute Pass 与 Storage Texture
learningOutcomes:
  - 能解释 CPU BVH 构建与 GPU 遍历之间的数据契约
  - 能区分 Diffuse、Metal、Dielectric 的散射和法线方向要求
  - 能证明渐进式 running mean、SPP 与状态重置的正确关系
relatedProjects:
  - webgpu-compute-lab
relatedDemos:
  - path-tracer
relatedArticles:
  - webgpu-particles-path-tracing
  - path-tracing-to-neural-denoising
englishTitle: "A WebGPU Path Tracer: BVH Traversal, Material Scattering, and Linear Accumulation"
englishDescription: From a CPU median-split BVH to WGSL traversal, three material classes, rectangular-light sampling, rgba16float accumulation, and a separate display pass.
publishedAt: 2026-08-31
updatedAt: 2026-08-31
draft: false
---

## 目标是正确的样本历史，不是一次漂亮截图

渐进式路径追踪器每帧只增加少量 Monte Carlo 样本。单帧必然带噪，真正的系统契约是：几何求交正确、散射权重可解释、累积保持在线性空间、任何会改变样本分布的状态都能使历史失效。

当前 Demo 使用小型 Cornell 风格程序化场景、CPU median-split BVH、原生 WebGPU Compute、Diffuse/Metal/Dielectric 三类材质、矩形光源直接采样和最多四次反弹。它是范围明确的学习实现，不包含纹理、MIS、重要性采样环境、实例化或生产级降噪。

```text
CPU scene
  → triangles + materials
  → median-split BVH
  → encoded GPU buffers
  → WGSL ray generation / traversal / scattering
  → linear rgba16float running mean
  → display pass / tone map / gamma
```

## 从像素生成相机光线

Compute Shader 以二维 invocation 对应像素。像素中心加随机偏移，得到本帧的子像素样本；再根据分辨率和 aspect ratio 构造相机空间方向。

```wgsl
let random = random2(vec3f(vec2f(pixel), frame));
let uv = (vec2f(pixel) + random) / resolution;
let screen = (uv * 2.0 - 1.0) * vec2f(aspect, 1.0);
var origin = vec3f(0.0, 0.35, -4.5);
var direction = normalize(vec3f(screen.x, -screen.y, 1.85));
```

这里的 `frame` 同时参与随机序列和累积权重。Reset 后 frame 必须回到零，否则第一张新图会继续沿用旧序列与旧平均值。

## CPU 构建 BVH，GPU 只做遍历

场景几何在初始化时已知，因此不必把 BVH 构建也塞进首版 GPU 路径。CPU 对三角形质心计算包围盒，选择最长轴，中位数切分，叶子最多包含四个三角形。构建后会重排三角形，使每个叶子的三角形连续存储。

当前编码契约是：

| 数据     | 每项大小 | 主要字段                              |
| -------- | -------: | ------------------------------------- |
| Triangle | 64 bytes | 三个 `vec4f` 顶点 + material index    |
| BVH Node | 48 bytes | bounds min/max + child 或 leaf 元数据 |
| Material | 32 bytes | color/type + roughness/emission/IOR   |

GPU 端使用显式栈遍历。AABB 测试先用 `1 / direction` 计算三个轴的 near/far 区间；只有包围盒可能包含比当前最近命中更近的三角形时，才继续进入节点。叶子中再执行 Möller–Trumbore 三角形求交。

CPU 参考测试会对同一组射线比较 BVH 与 brute-force 最近命中。这类测试不能证明所有浮点边界都正确，但能防止节点编码、三角形重排和 child index 的结构性错误。

## 中位数切分的取舍

Median split 的优势是确定、简单且容易测试；它保证左右子树数量接近，却不保证表面积代价最小。对于当前小场景，它比 SAH 更适合用来验证数据流。场景变大后，构建质量会直接影响遍历节点数，此时才有理由引入 SAH、wide BVH、Morton code 或 GPU build。

不要把“有 BVH”直接等同于“性能足够”。应记录：节点数、叶子分布、每条射线访问节点数、三角形测试数以及构建时间。当前公开 Demo 没有发布这些跨设备指标，因此文章只声明结构和一致性测试。

## Diffuse：余弦半球与吞吐量

Diffuse 表面从朝向法线的余弦加权半球采样新方向。路径吞吐量乘以材质颜色，矩形光源直接采样作为一个显式照明估计加入 radiance。

```text
radiance += throughput × directLight
throughput *= baseColor
direction = cosineHemisphere(normal, random)
```

当前实现没有完整 MIS。直接光与后续随机路径的组合是受控教学近似；它能展示 shadow ray、面积、距离平方衰减和表面/光源余弦项，但不能代表复杂灯光场景的低方差积分器。

## Metal：反射与 Roughness

理想金属沿反射方向继续路径。为展示 Roughness，Demo 在反射方向和余弦半球方向之间做近似混合，并用 Roughness 的平方控制偏离程度。

这种做法便于观察，但不是完整 GGX VNDF 采样。它的正确边界是“粗糙反射教学近似”，不能被描述成与 PBR raster 路径完全一致。若需要能量与 PDF 严格匹配，应显式实现微表面分布、几何项、Fresnel 和采样概率。

## Dielectric：必须保留几何法线和 front face

玻璃材质最容易出现一个隐蔽错误：为了着色方便先把法线翻向入射方向，然后再用已经翻转的法线判断射线是进入还是离开介质。这样所有命中都会被误判为进入。

当前实现保留原始 geometric normal，先计算：

```ts
const frontFace = dot(direction, geometricNormal) < 0;
const etaIncident = frontFace ? 1.0 : ior;
const etaTransmitted = frontFace ? ior : 1.0;
const eta = etaIncident / etaTransmitted;
```

随后才得到 oriented shading normal。Schlick 近似决定反射概率，`refract` 返回接近零向量时视为全反射。CPU 测试同时覆盖进入和离开，防止 IOR 比值方向被再次写反。

## 自相交、NaN 与遍历栈

新的射线从命中点原地出发会再次命中原三角形。Demo 根据法线或新方向加入小偏移；偏移过小会产生 acne，过大则漏过相邻几何。这个 epsilon 与场景尺度相关，不应成为跨场景常数。

其他必须显式观察的故障包括：

- 零长度方向或非法 `normalize` 传播 NaN；
- AABB 中方向分量接近零导致无穷倒数；
- BVH 深度超过固定栈容量；
- Firefly 样本主导低 SPP 画面；
- IOR、Roughness 或 emission 超出约定范围；
- `rgba16float` 中过大 radiance 丢失精度。

当前场景和 median split 深度受控，WGSL 栈容量为 64，遍历迭代也有上限。生产实现应统计 overflow，而不是静默丢节点。

## 线性累积与 SPP

累积纹理保存的是 Tone Mapping 前的线性 HDR 平均值。第 `n` 个新样本的 running mean 为：

```text
average(n) = previous + (sample - previous) / (n + 1)
```

WGSL 中等价地使用 `mix(previous, sample, 1 / (frame + 1))`。两张 `rgba16float` Storage Texture 交替读写，避免同一 Dispatch 对同一像素既读又写造成资源冲突。Compute 完成后，独立 Display Pass 读取最新累积，执行 ACES 近似和显示 gamma。

如果先 Tone Map 每个样本再平均，结果不等于先平均 radiance 再 Tone Map；因此显示变换必须和累积解耦。

## 状态签名与 Reset

下列变化会改变样本分布或像素含义，必须清空累积：

- 分辨率改变；
- 相机或投影改变；
- 反弹次数改变；
- 场景几何、材质或灯光改变；
- Shader 或积分器版本改变；
- WebGPU device lost 后资源重建。

当前 Demo 把 resize、bounce 控件和 Reset SPP 接到明确的 `reset()`。Pause 则取消 RAF，不再提交 Compute 或 Display 工作；恢复后继续同一历史。

## 可复现实验

1. 用固定射线集合比较 BVH 与 brute-force 最近命中；
2. 分别选择 1–4 次反弹，确认每次变化都把 SPP 重置为零；
3. Pause 后检查页面不再提交新帧，SPP 保持不变；
4. 对固定像素记录 1、2、4、8、16 SPP 的线性平均，检查 running mean；
5. 切换 Diffuse、Metal、Dielectric 场景对象，观察 geometric normal 与 IOR 分支；
6. 在无 WebGPU 环境中确认 Canvas 只被描述为视觉近似，不把其帧节奏当作 GPU 性能。

## 当前边界

该路径追踪器没有纹理、实例、运动模糊、景深、MIS、Russian Roulette、环境重要性采样、SAH BVH 或真正 HDR 输出。它也没有证明误差在每个像素单调下降；Monte Carlo 单样本误差本来就会波动。可验证的结论是：历史平均公式正确、BVH 与 brute force 在测试射线上一致、状态变化会 reset、材质介质方向可被测试，且显示变换不会污染线性累积。
