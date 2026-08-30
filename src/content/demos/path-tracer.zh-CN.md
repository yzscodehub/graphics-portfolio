---
routeSlug: path-tracer
translationKey: path-tracer
locale: zh-CN
title: Progressive Path Tracer
summary: 用原生 WebGPU 实现小型场景的 BVH 求交、渐进采样和累积缓冲。
category: gpu
renderer: Raw WebGPU + WGSL
backend: raw-webgpu
status: idea
featured: false
capabilities:
  - webgpu
requirements:
  - webgpu
controls:
  - Samples Per Pixel
  - "Bounce Limit: 1–4"
  - "Material: Diffuse / Metal / Dielectric"
  - Accumulation Reset
  - Pause / Restart
metrics: []
fallbackImage: /media/placeholders/demo-path-tracer.svg
relatedProjects:
  - webgpu-compute-lab
relatedArticles:
  - webgpu-particles-path-tracing
draft: false
---

## 展示目标

小型 Cornell 场景由 CPU 构建 BVH，GPU 生成样本并写入累积纹理。相机、材质、分辨率或反弹次数发生变化时，历史样本必须清空；否则不同投影会被错误混合。

## 明确限制

这是资源、采样和重置逻辑的原型，不包含生产级光源采样、压缩 BVH 或去噪。最多四次反弹只用于保持交互可控，不代表离线质量或硬件性能承诺。
