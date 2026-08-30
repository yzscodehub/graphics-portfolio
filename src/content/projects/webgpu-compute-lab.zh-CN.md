---
routeSlug: webgpu-compute-lab
translationKey: webgpu-compute-lab
locale: zh-CN
title: WebGPU Compute Lab
summary: 通过 GPU 粒子、间接绘制和渐进式路径追踪实验 WebGPU 的资源、计算和同步模型。
year: 2026
status: idea
role: 独立开发 / GPU Systems Engineer
platforms:
  - WebGPU
  - WGSL
technologies:
  - TypeScript
  - WebGPU
  - WGSL
  - Storage Buffer
  - Compute Shader
heroImage: /media/placeholders/project-webgpu-compute-lab.svg
responsibilities:
  - 设计 CPU 与 GPU 之间的最小数据交换路径
  - 用 Storage Buffer 和 Compute Pipeline 更新粒子状态
  - 记录不同质量等级下的帧时间和回退行为
featureSlugs:
  - storage-buffer
  - ping-pong-buffer
  - compute-dispatch
  - progressive-path-tracing
demoSlugs:
  - gpu-particles
  - path-tracer
articleSlugs:
  - compute-geometry-performance
  - webgpu-particles-path-tracing
architecture: CPU 负责参数和命令组织，Compute Pass 更新结构化缓冲，Render Pass 消费同一份 GPU 状态；路径追踪实验另行使用累积纹理保存历史样本。
metrics: []
limitations:
  - 需要安全上下文和支持 WebGPU 的浏览器
  - 路径追踪场景刻意保持小规模，不能代表生产级加速结构
draft: false
---

## 项目结论

WebGPU 的学习重点不只是把画面画出来，而是理解资源如何声明、命令如何提交，以及 CPU 和 GPU 如何在不必要的往返中保持独立。这个实验室把两个互补的案例放在一起：粒子系统强调持续的 Compute 更新，渐进式路径追踪强调累积缓冲和采样重置。

## GPU 粒子路径

粒子的状态存放在 Storage Buffer 中，每一帧由 Compute Shader 读取位置、速度和寿命，写入下一个缓冲。使用 Ping-Pong Buffer 是为了避免同一 Dispatch 同时读写同一份状态；渲染阶段只读取当前缓冲，并将粒子实例化为点或小四边形。

```text
parameters → command encoder
           → compute(pass: state[n] → state[n+1])
           → render(pass: state[n+1] → canvas)
```

粒子数量切换会改变缓冲大小和 Dispatch 数量，Demo 通过质量等级限制移动设备上的默认规模。性能面板分别报告 Compute 和总帧时间，避免将浏览器合成时间误认为着色器耗时。

## 渐进式路径追踪

路径追踪原型使用 CPU 构建的小型 BVH，GPU 每帧生成一批样本并累积到历史纹理。相机、材质或分辨率变化时必须清空累积，否则旧样本与新投影混合会产生错误的鬼影。最多四次反弹是展示资源和采样逻辑的边界，不是质量承诺。

## 资源与同步

每个 Buffer 的用途、大小和使用阶段都应能在代码中找到；Command Encoder 只在资源声明完成后编码。WebGPU 抽象了许多底层屏障细节，但并不意味着可以忽略用法和生命周期。设备丢失时，Demo 会显示状态并释放控制器，让页面回退到录制结果。

## 当前边界

浏览器的 WebGPU 支持和驱动差异很大，演示只在能力检测通过时启动。这里的路径追踪没有实现生产级光源采样、压缩 BVH 或去噪；后续神经降噪实验会复用它生成的低采样/高采样图像对。
