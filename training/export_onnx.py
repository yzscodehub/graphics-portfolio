#!/usr/bin/env python3
"""Export a real trained denoiser checkpoint to a fixed-shape ONNX model.

No checkpoint is bundled with the repository.  Passing a missing checkpoint is
an error, which prevents an untrained or fabricated model from being published.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import torch

from train_denoiser import ResidualDenoiser


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--opset", type=int, default=17)
    args = parser.parse_args()
    if not args.checkpoint.is_file():
        raise FileNotFoundError(f"Checkpoint does not exist: {args.checkpoint}")
    if args.opset < 17:
        raise ValueError("opset 17 or newer is required")

    checkpoint = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    if checkpoint.get("architecture") != "ResidualDenoiser-8conv":
        raise ValueError("Checkpoint architecture is not ResidualDenoiser-8conv")
    features = int(checkpoint.get("features", 32))
    shape = checkpoint.get("input_shape", [1, 3, 256, 256])
    if list(shape) != [1, 3, 256, 256]:
        raise ValueError(f"Expected fixed input shape [1, 3, 256, 256], got {shape}")

    model = ResidualDenoiser(features=features)
    model.load_state_dict(checkpoint["state_dict"])
    model.eval()
    example = torch.zeros(1, 3, 256, 256, dtype=torch.float32)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        model,
        example,
        args.output,
        input_names=["noisy_rgb"],
        output_names=["denoised_rgb"],
        opset_version=args.opset,
        dynamo=False,
    )
    print(f"Exported {args.output} from {args.checkpoint}")


if __name__ == "__main__":
    main()
