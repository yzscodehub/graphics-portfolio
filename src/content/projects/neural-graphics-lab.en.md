---
routeSlug: neural-graphics-lab
translationKey: neural-graphics-lab
locale: en
title: Neural Graphics Lab
summary: A completed, narrowly scoped denoising workflow with hashed held-out assets, ONNX WebGPU/WASM inference, and deterministic fallback.
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
  - SHA-256 asset verification
heroImage: /media/projects/neural-graphics-lab-cover.svg
architectureImage: /media/projects/neural-graphics-lab-architecture.svg
architectureAlt: "Data flow from hashed held-out pairs through the eight-layer residual CNN and ONNX WebGPU/WASM selection to metrics."
demoImage: /media/runtime/neural-graphics-lab-runtime.png
demoImageAlt: "Live ONNX Runtime WASM capture after an explicit reviewed-model run, showing held-out output, L1, PSNR, and P50/P95."
environment:
  - "Capture OS: Windows NT 10.0 x64"
  - "Browser: Chromium 151.0.7922.34, 1600x1000 CSS px, DPR 1"
  - "Backend: ONNX Runtime Web single-thread WASM; no WebGPU adapter in the headless environment"
  - "Input: hashed 1x3x256x256 held-out noisy/reference pair"
reproduction: "Click RUN REVIEWED MODEL; verify manifest and float-asset SHA-256, validate output shape, then recompute current-pair L1, PSNR, and post-warm-up P50/P95."
responsibilities:
  - Maintains a deterministic Canvas probe for the no-run state
  - Validates the held-out manifest and paired float assets before model execution
  - Reports L1/PSNR against the held-out reference and P50/P95 inference samples after warm-up
  - Documents model provenance and distribution limits
featureSlugs:
  - deterministic-probe
  - hashed-heldout-pair
  - explicit-model-run
  - onnx-webgpu-wasm
  - offline-validation
demoSlugs:
  - neural-denoising
articleSlugs:
  - path-tracing-to-neural-denoising
evidence: measured
backends:
  - id: onnx-web
    label: ONNX Runtime WebGPU / single-thread WASM
    role: primary
    capabilities:
      - webgpu
      - wasm
  - id: canvas-2d
    label: Deterministic Canvas 2D probe
    role: fallback
    capabilities: []
requirements:
  - label: Reviewed ONNX model and hashed held-out manifest
    required: false
  - label: WebGPU execution provider (optional)
    required: false
    capability: webgpu
  - label: Single-thread WASM fallback
    required: false
    capability: wasm
fallback:
  kind: canvas-2d
  description: The deterministic Canvas probe remains available until an explicit reviewed-model run succeeds.
  image: /media/projects/neural-graphics-lab-cover.svg
metricSource:
  kind: offline-validation
  description: L1/PSNR values are from the independent held-out validation record; P50/P95 are measured only by an explicit browser inference run.
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
architecture: The browser verifies a hashed held-out pair, selects ONNX Runtime WebGPU or WASM only after an explicit click, computes image metrics, and keeps a deterministic Canvas fallback for all failures.
limitations:
  - Metrics apply only to the documented procedural validation distribution
  - The browser probe is not the held-out validation frame; no production-scene, temporal, arbitrary-HDR, or universal timing claim is made
draft: false
---

## What runs

The page starts with a deterministic Canvas probe so visitors can inspect noisy, denoised, reference, and error views without loading model data. `RUN REVIEWED MODEL` is an explicit action: the page fetches the versioned held-out manifest and paired float assets, validates their byte lengths and SHA-256 hashes, and only then creates ONNX Runtime WebGPU or single-thread WASM inference.

## Evidence boundary

After warm-up, the reviewed run computes L1 and PSNR against the hashed held-out reference and reports P50/P95 inference samples. The confirmed L1, PSNR, and artifact values are offline validation evidence; the initial Canvas probe is not that validation set and cannot reproduce those numbers.

The model remains scoped to the small procedural distribution documented by the model card. Textures, motion, arbitrary HDR, complex geometry, and production-scene transfer are outside the evidence.
