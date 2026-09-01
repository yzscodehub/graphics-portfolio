# Guided candidate promotion evaluation

## Status

**Promotion denied.** The trained 9-channel Guided model passed numerical ONNX
parity but did not improve validation L1 over the reviewed RGB baseline on the
same fixed split. The public model manifest must therefore retain the
hash-bound static candidate and Production verification must remain blocked.

## Reproducible run

- Environment: Python 3.12.3, PyTorch 2.5.1+cpu, NumPy 2.1.3, ONNX 1.17.0,
  ONNX Runtime 1.20.1.
- Data: procedural-cornell-mc-v1, 64 train / 16 validation scenes, 256 x 256,
  1-SPP noisy / 64-SPP reference, train seeds 7301-7364 and validation seeds
  91103-91118.
- RGB and Guided both used 16 features, 50 epochs, batch size 4, AdamW, L1,
  learning rate 0.0002, seed 7, CPU.
- Guided input: Noisy RGB + deterministic first-hit Albedo RGB + remapped
  World Normal XYZ.

## Validation evidence

| Model                    |          L1 |       PSNR |
| ------------------------ | ----------: | ---------: |
| Noisy RGB input          | 0.001053629 | 45.3963 dB |
| Reviewed RGB baseline    | 0.000643527 | 50.8521 dB |
| Guided 9-channel attempt | 0.001058124 | 45.4173 dB |

The Guided attempt is worse than the RGB baseline by 0.000414597 L1. Its
slight PSNR gain relative to raw noisy input does not satisfy the required
same-split improvement over the RGB baseline.

## ONNX parity

- RGB maximum absolute PyTorch/ONNX difference: 8.94070e-8.
- Guided maximum absolute PyTorch/ONNX difference: 2.98023e-8.
- Required tolerance: 1e-4.

Both exports pass parity. Parity only establishes export fidelity; it is not
quality evidence and cannot override the failed L1 promotion gate.
