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

The generator writes the first validation pair as `scene-0064` after the 64
training scenes. The browser keeps a stable public asset prefix, `scene-0001`,
but its held-out manifest records `sourceDatasetStem: scene-0064`, the source
dataset-manifest SHA-256, and the distinct export version. The alias is only a
public filename; it is not a second validation scene.

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
- Browser artifact manifest: `public/models/neural-denoiser.manifest.json`;
  it binds the exact ONNX byte length/hash, input/output names, fixed NCHW
  shape, opset, and the hashed held-out manifest.

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
Raw datasets and checkpoints remain ignored. The published artifacts reproduce
and audit the browser's single held-out pair and its byte-level contracts; they
do **not** independently recompute the complete 16-scene offline validation or
PyTorch/ONNX parity without the retained private dataset and checkpoint record.

## Guided candidate status

The site also contains a **Guided candidate** contract with 9-channel input:
Noisy RGB, Albedo RGB, and remapped World Normal XYZ. It is deliberately not a
second trained model. The public candidate output is a hash-bound static
edge-aware filter generated from the public noisy image and procedural guide
fields. It has no checkpoint, no ONNX graph, no parity record, and no
validation L1 or PSNR claim.

Production verification must reject this candidate. It may be replaced only
after a reviewed 9-channel checkpoint uses the same 64/16 split, documents
PyTorch/ONNX parity, and improves both validation L1 and PSNR against the
reviewed RGB baseline on that same split.

The first fixed-budget 9-channel attempt was evaluated and denied promotion;
see training/guided-candidate-evaluation.md. The candidate remains a static
contract artifact rather than a trained public model.
