# Reviewed browser models only

`neural-denoiser.onnx` is an educational 8-convolution residual denoiser
trained only on deterministic, self-generated procedural Monte Carlo pairs.
No downloaded image or third-party model weight is used.

`neural-denoiser.manifest.json` is the browser and release-gate contract for
the exact ONNX bytes, SHA-256, input/output names, fixed NCHW shape, opset, and
the hashed held-out manifest. Regenerate it with
`training/write_model_manifest.py` whenever a reviewed model or held-out pair
changes.

See `training/model-card.md` and `neural-denoiser.metrics.json` for provenance,
validation, numerical parity, and limitations. The browser Demo retains a
deterministic fallback for unsupported devices or failed model loading.
