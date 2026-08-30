---
routeSlug: neural-denoising
translationKey: neural-denoising
locale: en
title: Neural Denoising
summary: Run a reviewed 8-convolution residual CNN in the browser and compare 1-SPP input, 64-SPP reference, model output, and an error view.
category: machine-learning
renderer: ONNX Runtime Web
backend: onnx-web
status: completed
featured: true
capabilities:
  - webgpu
  - wasm
requirements:
  - WebGPU preferred
  - Single-threaded WASM fallback
controls:
  - Noisy / Denoised / Reference
  - Error Heatmap
  - Runtime backend and inference time
metrics:
  - label: Validation L1 reduction
    value: 38.9%
    status: confirmed
  - label: Validation PSNR improvement
    value: +5.46 dB
    status: confirmed
fallbackImage: /media/placeholders/demo-neural-denoising.svg
relatedProjects:
  - neural-graphics-lab
relatedArticles:
  - path-tracing-to-neural-denoising
draft: false
---

## What runs

The page loads `neural-denoiser.onnx` only after the Demo enters the viewport. ONNX Runtime tries WebGPU before WASM, reports measured inference time, and preserves a deterministic Canvas fallback if loading, shape validation, or inference fails.

The reviewed model accepts `1×3×256×256` RGB and contains exactly eight convolution layers. Its 62,986-byte artifact was exported with opset 17 and passed PyTorch/ONNX parity with a maximum absolute difference of `8.94e-8`.

## Evidence and boundary

On 16 held-out procedural scenes, L1 changed from `0.001054` to `0.000644`, while PSNR changed from `45.40 dB` to `50.85 dB`. These results apply only to the self-generated Cornell-style distribution; they are not a production denoising or generalization claim. Full provenance and limitations live in `training/model-card.md`.
