---
routeSlug: neural-graphics-lab
translationKey: neural-graphics-lab
locale: en
title: Neural Graphics Lab
summary: A reproducible path from self-generated Monte Carlo image pairs to a validated residual CNN, ONNX export, and browser inference.
year: 2026
status: completed
role: Independent graphics and machine-learning engineering
platforms:
  - Python
  - Browser
  - WebGPU / WASM
technologies:
  - PyTorch
  - NumPy
  - ONNX
  - ONNX Runtime Web
  - WebGPU
heroImage: /media/placeholders/project-neural-graphics-lab.svg
responsibilities:
  - Built a deterministic procedural Monte Carlo paired-data generator
  - Trained and evaluated an eight-convolution residual CNN
  - Verified PyTorch/ONNX numerical parity and browser artifact size
  - Implemented WebGPU, WASM, and deterministic Canvas fallback states
featureSlugs:
  - paired-data-generation
  - residual-denoiser
  - onnx-parity
  - inference-timing
demoSlugs:
  - neural-denoising
articleSlugs:
  - path-tracing-to-neural-denoising
architecture: A local NumPy renderer produces disjoint training and validation scenes, PyTorch trains a fixed-shape residual CNN, ONNX Runtime Web selects WebGPU or WASM, and the UI keeps a deterministic fallback.
metrics:
  - label: Validation L1 reduction
    value: 38.9%
    status: confirmed
  - label: Validation PSNR improvement
    value: +5.46 dB
    status: confirmed
  - label: ONNX size
    value: 62,986 bytes
    status: confirmed
limitations:
  - Results are limited to the small procedural renderer distribution
  - No temporal, arbitrary-HDR, texture, or production-scene evaluation
  - Browser device timing remains intentionally unclaimed
draft: false
---

## Outcome

This project now covers the complete reproducible path rather than stopping at an architecture sketch. The dataset contains 64 training and 16 disjoint validation scenes, generated without external images or model weights. A 1-SPP input is paired with an independently sampled 64-SPP reference.

The network has eight convolution layers and starts as an exact identity mapping through a zero-initialized residual head. After 50 CPU training epochs, the selected checkpoint reduced held-out L1 by approximately 38.9% and improved PSNR by approximately 5.46 dB on this procedural distribution.

## Deployment contract

```text
procedural paired data → PyTorch residual CNN → ONNX opset 17
                      → ONNX Runtime WebGPU / WASM
                      → deterministic Canvas fallback
```

The ONNX model is 62,986 bytes and its maximum difference from PyTorch is `8.94e-8`. The web Demo reports inference time but does not claim a universal speed number, because backend and device capabilities vary.

## Limits

The generator estimates direct area-light illumination, analytic shadows, and a deterministic ambient approximation. It is path-tracing-style educational data, not unbiased production ground truth. The model card deliberately limits every quality claim to the held-out procedural validation split.
