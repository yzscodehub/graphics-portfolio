---
translationKey: material-lighting-color-pipeline
routeSlug: material-lighting-color-pipeline
locale: zh-CN
title: 从 PBR 参数到显示像素：材质、IBL 与颜色链路
description: 以可校准场景拆解 Base Color、Metalness、Roughness、直接光、IBL、曝光和 Tone Mapping，建立可调试的实时材质工作流。
module: rendering
moduleOrder: 1
articleOrder: 1
level: intermediate
tags:
  - PBR
  - IBL
  - Color Pipeline
  - TSL
prerequisites:
  - 理解线性代数、法线和点积
  - 了解纹理采样与线性颜色空间
learningOutcomes:
  - 能把材质参数、光照积分和显示变换分成三个可验证阶段
  - 能解释 Metalness 与 Roughness 改变的是哪部分能量分配
  - 能用直接光、间接光和 Buffer 视图定位材质异常
relatedProjects:
  - real-time-rendering-lab
relatedDemos:
  - material-lighting
relatedArticles:
  - shadow-temporal-aa
englishTitle: "From PBR Inputs to Display Pixels: Materials, IBL, and the Color Pipeline"
englishDescription: A calibration-driven breakdown of material parameters, direct and image-based lighting, exposure, tone mapping, and debug views.
publishedAt: 2026-08-31
updatedAt: 2026-08-31
draft: false
---

## 问题不是“球体是否好看”

实时材质 Demo 很容易退化成一个可以旋转的模型：调几项参数、换一张环境图，然后凭直觉判断结果。这样的画面可以展示美术效果，却很难证明渲染链路是否正确。更可复现的方法是把最终像素拆成三个阶段：材质描述、光照积分、显示变换，并为每个阶段提供独立观察入口。

本文讨论的边界是单帧、表面着色和显示输出。阴影稳定性、时域重建和后处理历史留给下一篇；材质导入、纹理压缩与离线烘焙也不在本实验范围内。

```text
Material inputs
  ├─ Base Color / Metalness / Roughness / Normal
  ↓
Direct lighting + prefiltered environment lighting
  ↓ linear HDR
Exposure → Tone Mapping → display encoding
  ↓
Final / Normal / Roughness / Metalness / Direct / Indirect
```

## 先固定校准场景

如果相机、灯光、几何和环境同时变化，就无法判断像素差异来自哪里。当前 Material & Lighting Demo 使用固定球体、地面、程序化房间环境、主光、填充光和边缘光；相机只围绕目标旋转。它不加载外部 HDRI，也不依赖未经授权模型，因此场景输入可以在仓库中完整复现。

校准物至少要暴露三类表面：

- 连续曲率，用来观察高光尺寸、法线与视角关系；
- 接触地面，用来观察能量、阴影和环境反射是否脱离场景；
- 中性背景，用来避免色彩判断被背景亮度误导。

固定场景并不意味着画面必须静止。移动主光可以帮助识别高光是否跟随光源，旋转相机则能检查视角相关的 Fresnel 响应；关键在于每次只改变一个变量。

## Base Color、Metalness 与 Roughness 的职责

金属度工作流最重要的不变量是：同一份能量不能同时被漫反射和镜面反射重复计算。对于非金属，Base Color 主要描述漫反射颜色，法线入射时的镜面反射率保持在较低范围；对于金属，漫反射接近消失，Base Color 转而影响有色镜面反射。

可以把它理解为一次插值，而不是“给材质加金属光泽”：

```ts
const diffuseWeight = 1 - metalness;
const diffuseColor = baseColor * diffuseWeight;
const specularF0 = mix(dielectricF0, baseColor, metalness);
```

Roughness 改变的是微表面法线分布。较小值让能量集中在更窄的高光中，较大值把相同能量分散到更宽区域。它不应直接充当“亮度”滑杆。如果提高 Roughness 后整个物体无缘无故变暗，应检查 BRDF 的能量补偿、环境预过滤级别以及 Tone Mapping，而不是马上修改颜色。

## IBL 是一条独立的数据路径

直接光通常有明确方向和强度，环境光则来自整个半球。实时 IBL 会把不同 Roughness 对应的环境卷积结果预过滤到多个 mip 级别，着色时依据 Roughness 选择近似积分结果。当前实验通过 Three.js `PMREMGenerator` 从程序化 RoomEnvironment 构建这一输入。

这条路径应当能被单独关闭：

| 调试视图 | 保留内容                     | 主要用途                           |
| -------- | ---------------------------- | ---------------------------------- |
| Direct   | 主光、填充光、边缘光         | 检查光源方向、衰减与局部高光       |
| Indirect | PMREM 环境贡献               | 检查 IBL、Roughness mip 与金属反射 |
| Final    | Direct + Indirect + 显示变换 | 检查最终合成                       |

Direct 和 Indirect 都不是“更漂亮的滤镜”。它们是同一个材质方程的两组输入。若 Indirect 视图全黑，应先确认环境纹理和 `scene.environment`；若它过亮，则检查曝光和环境强度，不要在 Base Color 上抵消错误。

## 颜色链路必须保持线性边界

光照运算应在线性空间发生。显示编码颜色若未经转换直接参与乘加，会让中间调过暗、材质参数失去可比性。一个可审计的链路是：

1. Base Color 输入被解释为正确的颜色空间；
2. BRDF、直接光与 IBL 在线性 HDR 中合成；
3. Exposure 只缩放线性曝光量；
4. Tone Mapping 将 HDR 压缩到显示范围；
5. 最后执行显示编码。

Demo 提供 ACES、AgX 和 Linear 三种输出模式。Linear 不是推荐的最终观感，而是诊断工具：当 ACES 与 AgX 差异很大时，可以回到 Linear 检查问题是否已经存在于光照阶段。曝光也不应隐藏材质错误；它应该作用于整帧，而不是只修一个物体。

## 调试视图如何缩短定位路径

最终颜色只能告诉我们“结果不对”，无法说明哪一层出错。Material Demo 内的 Normal、Roughness 和 Metalness 模式会替换球体材质，Direct/Indirect 模式则分别关闭环境或显式灯光；它们是受控的重新渲染视图，不是从 G-Buffer 读取的附件。

独立的 Frame Inspector 使用另一套程序化 Reference Scene，展示 Albedo + Metalness、Normal + Roughness、HDR Lighting、Depth 与 Final 的真实附件契约。它适合说明“生产者、格式和范围应如何被检查”，但不能用来证明 Material Demo 当前球体的参数已经写入那些附件。两套场景必须分别记录，不能把 Inspector 截图当作 Material Renderer 的帧捕获。

建议按以下顺序排查：

1. Normal 是否连续、朝向是否正确；
2. Roughness 与 Metalness 是否落在预期范围；
3. Direct 与 Indirect 是否分别存在且能解释；
4. HDR Lighting 是否已经过曝或带有异常颜色；
5. Tone Map 前后差异是否符合所选曲线。

这种顺序把“材质不好看”变成可定位的资源和 Pass 问题。

## 常见失败模式

- **把颜色纹理当作线性数据。** 结果通常是中间调偏暗，随后又用灯光强度补偿。
- **把数据纹理当作颜色。** Roughness、Metalness 或法线被错误解码，参数不再保持物理意义。
- **用曝光修单个材质。** 场景其他区域随之失真，说明错误边界放错了。
- **环境与直接光重复烘焙。** 同一光源同时存在于显式灯光和环境输入，造成双重能量。
- **比较不同相机或不同 Tone Map 的截图。** 变量不受控，结论无法复现。
- **设备后端变化却不记录。** WebGPU 与 WebGL2 fallback 的精度和驱动路径不同，证据必须带后端标签。

## 可复现实验

打开 Material & Lighting Demo，固定相机后依次执行：

1. Metalness 设为 0、0.5、1，分别记录 Direct 和 Indirect；
2. Roughness 从低到高分三档，观察高光面积而不是只比较峰值亮度；
3. 在 Final、Direct、Indirect 间切换，确认三者的能量关系；
4. 保持材质不变，对比 ACES、AgX、Linear；
5. 另行打开 Frame Inspector，对照附件契约与排查顺序，并明确它不是该球体的同帧捕获；
6. 记录当前浏览器、Three.js 版本和实际 backend 标签。

实验不要求得出跨设备性能数字。它要验证的是：参数变化能被对应 Buffer 解释，直接光和 IBL 可以独立观察，显示变换不会反向污染材质判断。

## 当前边界

本实验没有覆盖纹理化材质、各向异性、Clearcoat 分层、透射、HDR 显示输出或生产级资产导入。程序化 PMREM 也不是对所有 HDR 环境的代表。它的价值是建立一条小而完整的校准链路，为更复杂的渲染功能提供可重复基线。

## 参考资料

- [Three.js WebGPU Renderer](https://threejs.org/manual/en/webgpurenderer)
- [Three.js Color Management](https://threejs.org/manual/en/color-management.html)
- [Filament: Physically Based Rendering in Filament](https://google.github.io/filament/Filament.html)
