# Reviewed browser models only

`neural-denoiser.onnx` is an educational 8-convolution residual denoiser
trained only on deterministic, self-generated procedural Monte Carlo pairs.
No downloaded image or third-party model weight is used.

See `training/model-card.md` and `neural-denoiser.metrics.json` for provenance,
validation, numerical parity, and limitations. The browser Demo retains a
deterministic fallback for unsupported devices or failed model loading.
