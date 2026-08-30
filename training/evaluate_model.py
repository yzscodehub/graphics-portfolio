#!/usr/bin/env python3
"""Evaluate a trained denoiser against local paired RGB .npy validation data.

Reports raw noisy-input and denoised-output L1/PSNR against the clean reference.
An optional ONNX Runtime pass checks exported-model numerical parity without
inventing any result when onnxruntime is unavailable or an export is absent.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Iterable

import numpy as np
import torch
from torch import Tensor

from train_denoiser import ResidualDenoiser


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, required=True, help="Local paired dataset root")
    parser.add_argument("--checkpoint", type=Path, required=True, help="Checkpoint written by train_denoiser.py")
    parser.add_argument("--split", choices=("train", "val"), default="val")
    parser.add_argument("--batch-size", type=int, default=2)
    parser.add_argument("--max-samples", type=int, help="Optional deterministic prefix for a quick evaluation")
    parser.add_argument("--device", choices=("auto", "cpu", "cuda"), default="auto")
    parser.add_argument("--onnx", type=Path, help="Optional exported ONNX model to compare with PyTorch")
    parser.add_argument("--onnx-tolerance", type=float, default=1e-4, help="Maximum absolute PyTorch/ONNX difference")
    return parser.parse_args()


def _device(name: str) -> torch.device:
    if name == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("--device cuda was requested but CUDA is unavailable")
    return torch.device("cuda" if name == "auto" and torch.cuda.is_available() else "cpu" if name == "auto" else name)


def _pairs(root: Path, split: str, maximum: int | None) -> list[tuple[Path, Path]]:
    noisy_dir = root / split / "noisy"
    clean_dir = root / split / "clean"
    noisy = {path.stem: path for path in noisy_dir.glob("*.npy")}
    clean = {path.stem: path for path in clean_dir.glob("*.npy")}
    if not noisy or not clean:
        raise FileNotFoundError(f"Expected paired .npy files under {noisy_dir} and {clean_dir}")
    if noisy.keys() != clean.keys():
        raise ValueError("Noisy and clean directories must have exactly matching stems")
    names = sorted(noisy)
    if maximum is not None:
        if maximum <= 0:
            raise ValueError("--max-samples must be positive")
        names = names[:maximum]
    return [(noisy[name], clean[name]) for name in names]


def _load_chw(path: Path, expected_size: int) -> np.ndarray:
    image = np.load(path, allow_pickle=False)
    if image.dtype.kind not in "fiu" or image.ndim != 3:
        raise ValueError(f"{path} must contain a numeric HxWx3 or 3xHxW array")
    if image.shape[-1] == 3:
        image = np.transpose(image, (2, 0, 1))
    elif image.shape[0] != 3:
        raise ValueError(f"{path} has no three-channel RGB axis: {image.shape}")
    if image.shape != (3, expected_size, expected_size):
        raise ValueError(f"{path} shape {image.shape} does not match checkpoint input 3x{expected_size}x{expected_size}")
    image = np.ascontiguousarray(image, dtype=np.float32)
    if not np.isfinite(image).all() or image.min() < 0.0 or image.max() > 1.0:
        raise ValueError(f"{path} must be finite float RGB normalized to [0, 1]")
    return image


class Metrics:
    def __init__(self) -> None:
        self.abs_sum = 0.0
        self.square_sum = 0.0
        self.elements = 0

    def add(self, prediction: np.ndarray, clean: np.ndarray) -> None:
        difference = prediction.astype(np.float64) - clean.astype(np.float64)
        self.abs_sum += float(np.abs(difference).sum())
        self.square_sum += float(np.square(difference).sum())
        self.elements += int(difference.size)

    def report(self) -> dict[str, float]:
        if self.elements == 0:
            raise RuntimeError("No samples were evaluated")
        l1 = self.abs_sum / self.elements
        mse = self.square_sum / self.elements
        psnr = float("inf") if mse == 0.0 else 10.0 * math.log10(1.0 / mse)
        return {"l1": l1, "psnr_db": psnr, "mse": mse}


def _batches(items: list[tuple[Path, Path]], size: int) -> Iterable[list[tuple[Path, Path]]]:
    if size <= 0:
        raise ValueError("--batch-size must be positive")
    for offset in range(0, len(items), size):
        yield items[offset : offset + size]


def _load_model(checkpoint_path: Path, device: torch.device) -> tuple[ResidualDenoiser, int]:
    if not checkpoint_path.is_file():
        raise FileNotFoundError(f"Checkpoint does not exist: {checkpoint_path}")
    checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=False)
    if checkpoint.get("architecture") != "ResidualDenoiser-8conv":
        raise ValueError("Checkpoint architecture is not ResidualDenoiser-8conv")
    shape = checkpoint.get("input_shape")
    if not isinstance(shape, list) or len(shape) != 4 or shape[:2] != [1, 3] or shape[2] != shape[3]:
        raise ValueError(f"Invalid checkpoint input_shape: {shape}")
    features = int(checkpoint.get("features", 32))
    model = ResidualDenoiser(features=features).to(device)
    model.load_state_dict(checkpoint["state_dict"])
    model.eval()
    return model, int(shape[2])


def _onnx_session(path: Path):
    if not path.is_file():
        raise FileNotFoundError(f"ONNX model does not exist: {path}")
    try:
        import onnxruntime as ort
    except ImportError as error:
        raise RuntimeError("--onnx requires a reviewed local onnxruntime installation") from error
    return ort.InferenceSession(path, providers=["CPUExecutionProvider"])


def _json_number(value: float) -> float | str:
    return "inf" if math.isinf(value) else value


def main() -> None:
    args = _parse_args()
    if args.onnx_tolerance <= 0.0:
        raise ValueError("--onnx-tolerance must be positive")
    device = _device(args.device)
    model, image_size = _load_model(args.checkpoint, device)
    pairs = _pairs(args.data_root.resolve(), args.split, args.max_samples)
    session = _onnx_session(args.onnx) if args.onnx else None
    noisy_metrics = Metrics()
    denoised_metrics = Metrics()
    parity_abs_sum = 0.0
    parity_max_abs = 0.0
    parity_elements = 0

    with torch.inference_mode():
        for batch in _batches(pairs, args.batch_size):
            noisy = np.stack([_load_chw(noisy_path, image_size) for noisy_path, _ in batch])
            clean = np.stack([_load_chw(clean_path, image_size) for _, clean_path in batch])
            input_tensor = torch.from_numpy(noisy).to(device)
            prediction = model(input_tensor).cpu().numpy()
            noisy_metrics.add(noisy, clean)
            denoised_metrics.add(prediction, clean)
            if session is not None:
                onnx_input = session.get_inputs()[0].name
                onnx_output = session.get_outputs()[0].name
                exported = np.concatenate(
                    [session.run([onnx_output], {onnx_input: noisy[index : index + 1]})[0] for index in range(noisy.shape[0])],
                    axis=0,
                )
                if exported.shape != prediction.shape:
                    raise ValueError(f"ONNX output shape {exported.shape} does not match PyTorch output {prediction.shape}")
                difference = np.abs(exported.astype(np.float64) - prediction.astype(np.float64))
                parity_abs_sum += float(difference.sum())
                parity_max_abs = max(parity_max_abs, float(difference.max()))
                parity_elements += int(difference.size)

    result: dict[str, object] = {
        "split": args.split,
        "samples": len(pairs),
        "checkpoint": str(args.checkpoint),
        "device": str(device),
        "noisy": {key: _json_number(value) for key, value in noisy_metrics.report().items()},
        "denoised": {key: _json_number(value) for key, value in denoised_metrics.report().items()},
    }
    if session is not None:
        parity_mean_abs = parity_abs_sum / parity_elements
        parity = {
            "onnx": str(args.onnx),
            "mean_abs": parity_mean_abs,
            "max_abs": parity_max_abs,
            "tolerance": args.onnx_tolerance,
            "pass": parity_max_abs <= args.onnx_tolerance,
        }
        result["onnx_parity"] = parity
        if not parity["pass"]:
            print(json.dumps(result, ensure_ascii=False, indent=2))
            raise RuntimeError(f"ONNX maximum absolute difference {parity_max_abs:.8g} exceeds tolerance {args.onnx_tolerance:.8g}")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
