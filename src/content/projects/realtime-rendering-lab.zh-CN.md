---
routeSlug: real-time-rendering-lab
translationKey: real-time-rendering-lab
locale: zh-CN
title: Real-Time Rendering Lab
summary: 一个围绕 PBR、IBL、阴影、抗锯齿和后处理的可调实时渲染实验台。
year: 2026
status: in-progress
role: 独立开发 / Rendering Engineer
platforms:
  - WebGL2
  - WebGPU（实验）
technologies:
  - TypeScript
  - Three.js
  - GLSL
  - TSL
  - PBR
heroImage: /media/placeholders/project-real-time-rendering-lab.svg
responsibilities:
  - 构建可重复的材质与光照对比场景
  - 记录从输入数据到最终颜色的调试视图
  - 比较不同阴影和抗锯齿策略的画质与成本
featureSlugs:
  - pbr-materials
  - image-based-lighting
  - shadow-filtering
  - anti-aliasing
demoSlugs:
  - material-lighting
  - shadow-aa
  - frame-inspector
articleSlugs:
  - rhi-abstraction-boundaries
  - compute-geometry-performance
architecture: 场景、材质、光照和后处理作为相互独立的实验模块，统一由 Demo Shell 管理尺寸、暂停、质量等级和回退。
metrics: []
limitations:
  - 浏览器 Demo 的结果不能代表所有桌面 GPU 和原生后端
  - TAA 与部分高级阴影模式会根据运行环境降级为静态对比
draft: false
---

## 项目结论

这个实验室的目标不是堆叠视觉效果，而是让每个效果都能回答一个问题：输入是什么、它在管线的哪一步生效、改变了哪类误差、付出了什么成本。访客可以在校准物上切换材质参数、环境光照和调试视图，再用同一场景比较阴影与抗锯齿。

## 场景与颜色链路

校准物使用简单、可重复的几何和材质，避免复杂资产掩盖光照差异。材质参数在近似线性空间中参与光照计算，最终经过曝光、色调映射和显示转换后输出。调试视图会在不同阶段停住，帮助区分法线错误、粗糙度错误和颜色管理错误。

```text
material inputs → direct / image-based lighting → HDR buffer
                → post process → exposure / tone map → display color
```

这里的“物理”只表示参数和能量关系遵循常用的实时 PBR 近似，并不声称浏览器实现了完整离线渲染器。IBL 使用预过滤环境近似镜面反射，粗糙度升高时查询更宽的 mip；这比用一个固定颜色填充环境更能解释参数变化。

## 阴影与抗锯齿

阴影实验把采样数量、过滤半径和偏移拆成独立变量。硬阴影适合观察深度比较，PCF 能降低边缘锯齿但会增加采样，PCSS 则把遮挡物与接收面距离引入半影估计。抗锯齿实验展示几何边缘和高频材质各自的伪影，TAA 需要速度信息或历史有效性判断，否则相机移动时容易拖影。

## 可观察性

每个视图都带有“当前假设”：例如 Normal 视图用于检查切线空间方向，Depth 视图显示非线性深度，Lighting 视图则用于确认直接光和间接光是否在预期阶段合成。性能面板只报告浏览器实际测到的帧时间，不把不同设备的结果混在一起。

## 当前边界

WebGL2 是可靠回退，WebGPU/TSL 用于新写的路径，但两条路径的精度、驱动和后处理能力并不完全相同。所有高级效果都必须有静态截图或录制视频回退；演示的目的，是把渲染决策讲清楚，而不是要求每位访客拥有相同硬件。
