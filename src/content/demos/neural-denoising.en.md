---
routeSlug: neural-denoising
translationKey: neural-denoising
locale: en
title: Neural Denoising
summary: Run an explicitly requested ONNX model against a hashed held-out pair, with WebGPU/WASM selection and deterministic fallback.
category: machine-learning
renderer: ONNX Runtime WebGPU/WASM + deterministic Canvas probe
backend: onnx-web
status: in-progress
maturity: in-progress
evidence: measured
backends:
  - id: onnx-web
    label: ONNX Runtime WebGPU or single-thread WASM
    role: primary
    capabilities:
      - webgpu
      - wasm
  - id: canvas-2d
    label: Deterministic procedural fallback
    role: fallback
    capabilities: []
capabilities:
  - webgpu
  - wasm
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
  description: Before and after a reviewed run, the page keeps a deterministic procedural Canvas probe available without downloading model data.
  image: /media/demos/neural-denoising-poster.svg
controls:
  - NOISY
  - DENOISED
  - REFERENCE
  - ERROR
  - RUN REVIEWED MODEL
  - SHOW GUIDED CANDIDATE
metrics:
  - label: Validation L1 reduction
    value: 38.9%
    status: confirmed
    source: public/models/neural-denoiser.metrics.json / independent held-out offline validation
  - label: Validation PSNR improvement
    value: +5.46 dB
    status: confirmed
    source: public/models/neural-denoiser.metrics.json / independent held-out offline validation
  - label: Inference P50
    value: runtime
    status: measured
    source: Explicit browser run after RUN REVIEWED MODEL
  - label: Inference P95
    value: runtime
    status: measured
    source: Explicit browser run after RUN REVIEWED MODEL
metricSource:
  kind: offline-validation
  description: Confirmed L1/PSNR values come from the independent held-out pair and offline validation record; P50/P95 are measured only after an explicit browser run and vary by device/backend.
currentLimit: Guided remains an unreviewed static candidate with no ONNX quality claim; only the reviewed RGB model is completed.
fallbackImage: /media/demos/neural-denoising-poster.svg
relatedProjects:
  - neural-graphics-lab
relatedArticles:
  - path-tracing-to-neural-denoising
assetIds:
  - neural-heldout-v2
modes:
  - rgb
  - guided
sourceUrl: https://github.com/yzscodehub/graphics-portfolio/blob/main/src/demos/neural-denoising.ts
draft: false
---

## What runs

The page initially renders a deterministic procedural probe. It does not silently download model data. Clicking `RUN REVIEWED MODEL` fetches the versioned held-out manifest and paired float assets, validates their byte lengths and SHA-256 hashes, then selects ONNX Runtime WebGPU when available or single-thread WASM otherwise.

## Model status

The RGB model is reviewed and is the completed part of this Demo. Its
published L1 and PSNR values belong only to that reviewed RGB model.

Guided is a hash-bound static candidate, not a reviewed ONNX model. It has no
published quality improvement claim and remains blocked from Release until a
same-split reviewed model improves both L1 and PSNR.

## Evidence and metrics

The reviewed run computes L1 and PSNR against the hashed held-out reference pair and reports the measured P50/P95 inference samples after warm-up. The static L1/PSNR improvements come from the independent offline validation record; the browser probe is not that validation frame and cannot be used to reproduce those numbers.

## Fallback boundary

Model load, manifest validation, shape validation, provider initialization, and inference failures leave the deterministic Canvas probe visible. The UI labels backend and metric source so a runtime timing value is not confused with offline quality evidence.
