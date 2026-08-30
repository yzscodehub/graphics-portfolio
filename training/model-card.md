# Model card: ResidualDenoiser-8conv

## Status

Trained educational model included as `public/models/neural-denoiser.onnx`.
The model passed a complete 16-scene validation run and PyTorch/ONNX numerical
parity check. It is suitable only for the portfolio's procedural rendering
distribution and must not be described as a production denoiser.

## Intended use

Demonstrate an end-to-end local neural-graphics workflow: deterministic data
generation, residual-CNN training, ONNX export, ONNX Runtime Web inference,
and explicit browser fallback behavior. Input and output are fixed
`1 x 3 x 256 x 256` RGB tensors in `[0, 1]`.

## Architecture

- One `3 x 3` RGB-to-feature convolution followed by ReLU.
- Three residual blocks with two `3 x 3` convolutions each.
- One `3 x 3` feature-to-RGB residual head.
- Noisy input plus predicted residual, clamped to `[0, 1]`.
- Eight convolution layers, 16 feature channels, ONNX opset 17.
- Input `noisy_rgb`; output `denoised_rgb`.

The output head is zero-initialized during training, so the untrained network
starts as an exact identity mapping rather than degrading the input.

## Data provenance

- Generator: `training/generate_dataset.py`, version
  `procedural-cornell-mc-v1`.
- External assets or downloaded weights: none.
- Scene family: procedurally varied Cornell, cool-studio, and warm-studio
  rooms with analytic spheres, material parameters, area lights, and hard
  sphere shadows.
- Train: 64 scenes, seeds 7301-7364.
- Validation: 16 disjoint scenes, seeds 91103-91118.
- Resolution: 256 x 256 RGB `float32`.
- Noisy estimator: 1 sample per pixel.
- Reference estimator: 64 samples per pixel using an independent stream.
- Color pipeline: linear radiance, Reinhard tone map, gamma `1/2.2`.
- Manifest SHA-256:
  `7b6eacc3eb5f32ed9e1ae14d76a1ffdf4fb426b7ac5fffeb025cac177fc7dd4c`.

Reviewed dataset command:

```powershell
python training/generate_dataset.py `
  --output-root D:/datasets/portfolio-procedural-v1 `
  --train-count 64 `
  --val-count 16 `
  --size 256 `
  --noisy-spp 1 `
  --clean-spp 64
```

The renderer estimates direct area-light illumination, analytic shadows, and
a deterministic ambient approximation. The 64-SPP reference remains a finite
Monte Carlo estimate, not full global-illumination ground truth.

## Training record

- Python 3.12.13; NumPy 2.5.2; PyTorch 2.13.0+cpu.
- Seed 7; 50 epochs; batch size 4; AdamW; L1 loss; learning rate 0.0002.
- Checkpoint SHA-256:
  `38591b689c7ffdb2b418d700bbbfc77116717e209db06e38468d9e8a1592f6e7`.
- ONNX size: 62,986 bytes.
- ONNX SHA-256:
  `f42af8be960e17c61bb19d4b82268541d3773eae0e5c14092c6f8d83c68e8413`.

## Validation results

Metrics are global element-weighted measurements in display-referred RGB,
with no crop, over all 16 validation scenes.

| Metric |  1-SPP input | Denoised output |
| ------ | -----------: | --------------: |
| L1     |  0.001053629 |     0.000643527 |
| MSE    | 0.0000288650 |   0.00000821847 |
| PSNR   |   45.3963 dB |      50.8521 dB |

The reviewed model reduces validation L1 by approximately 38.9% and improves
PSNR by approximately 5.46 dB on this procedural distribution.

ONNX Runtime 1.29.0 CPU parity against PyTorch:

- Mean absolute difference: `1.22945e-9`.
- Maximum absolute difference: `8.94070e-8`.
- Required tolerance: `1e-4`; result passed.

## Browser deployment

The Demo requests ONNX Runtime WebGPU first and WASM second. A model-load,
shape, or inference failure remains a visible deterministic fallback instead
of a blank Canvas. GitHub Pages does not provide the response headers needed
for multi-threaded WASM, so the CPU fallback is intentionally single-threaded.
Device-specific WebGPU and WASM timing is not claimed until measured in the
deployed browser.

## Limitations

- The procedural distribution is small and visually stylized.
- It excludes textures, motion, arbitrary HDR inputs, complex geometry, and
  temporal stability evaluation.
- Training and validation share renderer assumptions despite disjoint seeds.
- Display-referred metrics may hide HDR-domain errors.
- The network can erase legitimate detail outside its training distribution.
- Results do not transfer automatically to production path tracers.

## Reproduction

Commands and environment requirements are documented in `training/README.md`.
Raw datasets and checkpoints remain ignored because the manifest, model card,
and final ONNX artifact are sufficient to reproduce and audit the public demo.
