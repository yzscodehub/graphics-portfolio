---
routeSlug: webgpu-compute-lab
translationKey: webgpu-compute-lab
locale: zh-CN
title: WebGPU Compute Lab
summary: 通过 GPU 粒子和全屏渐进式路径研究观察 WebGPU 的资源与计算模型；高级加速结构列为后续路线。
year: 2026
status: idea
role: 独立开发 / GPU Systems Engineer
platforms:
  - WebGPU
  - Canvas 2D fallback
technologies:
  - TypeScript
  - WebGPU
  - WGSL
  - Storage Buffer
  - Compute Shader
heroImage: /media/placeholders/project-webgpu-compute-lab.svg
responsibilities:
  - 在原生 Compute Pass 中更新单个 read_write Storage Buffer
  - 使用原生 Render Pass 绘制同一份 GPU 粒子状态
  - 在 WebGPU 不可用时提供明确标注的 Canvas 预览
featureSlugs:
  - read-write-storage-buffer
  - compute-dispatch
  - progressive-accumulation
  - canvas-fallback
demoSlugs:
  - gpu-particles
  - path-tracer
articleSlugs:
  - compute-geometry-performance
  - webgpu-particles-path-tracing
architecture: CPU 负责参数和命令组织，Compute Pass 原地更新 Storage Buffer，Render Pass 随后绘制；路径研究使用两个颜色纹理保存渐进累积。
metrics: []
limitations:
  - 粒子当前没有 Ping-Pong Buffer、独立 GPU 计时、吸引子/噪声控件或间接绘制
  - 路径研究没有 CPU BVH、材质选择、Samples Per Pixel 或显式重置控件，只提供 2/3/4 反弹按钮
  - 需要安全上下文和支持 WebGPU 的浏览器；不支持时使用明确标注的 Canvas 预览
draft: false
---

## 当前实现

粒子实验把状态存放在一个 `read_write` Storage Buffer 中，由 Compute Pass 原地更新，随后 Render Pass 以点绘制同一份 Buffer。页面提供 25K、100K、250K 三个数量按钮；报告后端和粒子数量，但没有独立 GPU 计时。

路径研究由 WGSL 片元着色器绘制程序化房间、地面和两个球体，并使用两张颜色纹理保存渐进式结果。它提供 2、3、4 最大反弹按钮；没有 CPU BVH、材质选择、Samples Per Pixel 或显式重置控件。Ping-Pong、间接绘制、生产级加速结构和去噪属于后续路线。
