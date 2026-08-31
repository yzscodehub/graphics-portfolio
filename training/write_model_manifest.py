#!/usr/bin/env python3
"""Write the browser-verifiable manifest for a reviewed ONNX denoiser.

This utility deliberately does not inspect, convert, or modify the ONNX graph.
It hashes the exact reviewed bytes and records the fixed deployment contract
next to the model so the browser and release guards can reject substitutions.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def file_entry(path: Path, relative_to: Path) -> dict[str, object]:
    if not path.is_file():
        raise FileNotFoundError(f"Required reviewed artifact does not exist: {path}")
    try:
        relative = path.resolve().relative_to(relative_to.resolve()).as_posix()
    except ValueError as error:
        raise ValueError(f"{path} must be inside {relative_to}") from error
    return {"file": relative, "bytes": path.stat().st_size, "sha256": sha256(path)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--heldout-manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--input-name", default="noisy_rgb")
    parser.add_argument("--output-name", default="denoised_rgb")
    parser.add_argument("--opset", type=int, default=17)
    args = parser.parse_args()
    if args.opset < 17:
        raise ValueError("The reviewed browser contract requires ONNX opset 17 or newer")
    output_root = args.output.parent.resolve()
    model = args.model.resolve()
    heldout_manifest = args.heldout_manifest.resolve()
    model_entry = file_entry(model, output_root)
    heldout_entry = file_entry(heldout_manifest, output_root)
    if model_entry["bytes"] > 5 * 1024 * 1024:
        raise ValueError("Reviewed ONNX model exceeds the 5 MiB browser contract")

    tensor = {
        "dtype": "float32",
        "shape": [1, 3, 256, 256],
        "layout": "NCHW",
        "range": "[0,1]",
    }
    document = {
        "version": 1,
        "model": {
            **model_entry,
            "format": "onnx",
            "opset": args.opset,
            "input": {"name": args.input_name, **tensor},
            "output": {"name": args.output_name, **tensor},
        },
        "heldoutManifest": heldout_entry,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
    print(args.output)


if __name__ == "__main__":
    main()
