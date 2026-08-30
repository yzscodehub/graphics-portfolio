# Neural denoising training contract

This directory contains a completely local, reproducible path from procedural
paired RGB data to a small browser-ready denoiser. It contains no downloaded
assets or third-party weights. Raw datasets and checkpoints remain ignored;
the reviewed ONNX model, manifest hash, measurements, and limitations are
recorded in `model-card.md`.

## Reviewed portfolio run

- 64 training and 16 validation scenes at 256 x 256.
- 1-SPP noisy input and an independent 64-SPP reference.
- 16 feature channels, 50 epochs, AdamW, L1 loss, learning rate 0.0002.
- Validation L1: 0.001054 input -> 0.000644 denoised.
- Validation PSNR: 45.40 dB input -> 50.85 dB denoised.
- PyTorch/ONNX maximum absolute difference: 8.94e-8.

## Dataset generation

`generate_dataset.py` creates deterministic `float32` arrays in the exact
layout consumed by `train_denoiser.py`:

```text
dataset/
├── dataset-manifest.json
├── train/
│   ├── noisy/scene-0000.npy
│   └── clean/scene-0000.npy
└── val/
    ├── noisy/scene-0064.npy
    └── clean/scene-0064.npy
```

Every array is `H x W x 3`, `float32`, finite, and normalized to `[0, 1]`.
The manifest records each procedural scene's split, seed, material, lighting,
and render settings. Train and validation use separate default seed ranges.

The generator traces primary rays through a procedurally varied Cornell-style
room with analytic spheres, samples a rectangular area light, and applies hard
sphere shadows. The noisy image is a low-sample Monte Carlo estimate; the
clean image is a higher-sample estimate from an independent deterministic
sequence. It also includes a deterministic ambient approximation, so it is
accurately described as _path-tracing-style_ data rather than a full
multi-bounce path-tracing benchmark.

Generate the default 64 training and 16 validation scenes. On a typical modern
CPU, the default `256 x 256`, 2-SPP/16-SPP run is expected to take a few
minutes; exact timing depends on CPU, NumPy build, and available cores.

```powershell
python training/generate_dataset.py `
  --output-root D:/datasets/portfolio-procedural-v1
```

For a deterministic smoke test that normally completes in seconds, use a
different output directory and reduce both count and resolution:

```powershell
python training/generate_dataset.py `
  --output-root D:/datasets/portfolio-smoke `
  --train-count 2 `
  --val-count 1 `
  --size 32 `
  --noisy-spp 1 `
  --clean-spp 4
```

Re-running an existing output root fails by default. Pass `--overwrite` only
when intentionally replacing matching generated files. For a fixed Python,
NumPy version, platform, flags, and command line, scenes and estimates are
deterministic; bit-for-bit equality is not claimed across all BLAS/NumPy
builds or processor architectures.

## Train, export, and evaluate

Use a reviewed local Python 3.12 environment with NumPy and PyTorch. The
training model has exactly eight `Conv2d` layers: one stem, three two-layer
residual blocks, and one residual head. It accepts and exports only
`1 x 3 x 256 x 256` RGB tensors in `[0, 1]`.

```powershell
python training/train_denoiser.py `
  --data-root D:/datasets/portfolio-procedural-v1 `
  --output training/checkpoints/denoiser.pt `
  --device auto

python training/evaluate_model.py `
  --data-root D:/datasets/portfolio-procedural-v1 `
  --checkpoint training/checkpoints/denoiser.pt `
  --split val

python training/export_onnx.py `
  --checkpoint training/checkpoints/denoiser.pt `
  --output public/models/neural-denoiser.onnx
```

To test the actual exported graph, install a reviewed local `onnxruntime`
package and explicitly ask evaluation to compare it with PyTorch. The command
reports noisy and denoised L1/PSNR and fails if maximum absolute output error
exceeds the chosen tolerance; it never substitutes invented parity values.

```powershell
python training/evaluate_model.py `
  --data-root D:/datasets/portfolio-procedural-v1 `
  --checkpoint training/checkpoints/denoiser.pt `
  --onnx public/models/neural-denoiser.onnx `
  --onnx-tolerance 1e-4
```

`evaluate_model.py` evaluates full fixed-size images, uses no augmentation,
and reports global element-weighted L1, MSE, and PSNR in the display-referred
RGB color space. The reviewed measurements are recorded in `model-card.md`
and `public/models/neural-denoiser.metrics.json`.

## Publication constraints

- Do not commit `training/checkpoints/`, raw datasets, or temporary renders.
- Do not publish an ONNX file until its dataset manifest, license, validation
  result, and PyTorch/ONNX parity result have been reviewed.
- Record real device and browser timings separately. Python evaluation timing
  does not imply ONNX Runtime Web timing.
- The browser demo must continue to use its explicit WebGPU, WASM, and
  precomputed-output fallback states whenever a reviewed model is absent or
  cannot execute.
