"""Export one reviewed validation pair as browser-ready NCHW float32 binaries."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset-root", type=Path, required=True)
    parser.add_argument("--stem", default="scene-0001")
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--scene-seed", type=int, default=91_103)
    args = parser.parse_args()

    noisy = np.load(args.dataset_root / "val/noisy" / f"{args.stem}.npy", allow_pickle=False)
    reference = np.load(
        args.dataset_root / "val/clean" / f"{args.stem}.npy", allow_pickle=False
    )
    if noisy.shape != reference.shape or noisy.ndim != 3 or noisy.shape[2] != 3:
        raise ValueError(f"Expected matching HxWx3 arrays, got {noisy.shape} and {reference.shape}")
    if noisy.dtype != np.float32 or reference.dtype != np.float32:
        raise ValueError("Reviewed browser pair must remain float32")
    if not np.isfinite(noisy).all() or not np.isfinite(reference).all():
        raise ValueError("Reviewed browser pair contains non-finite values")

    args.output_root.mkdir(parents=True, exist_ok=True)
    outputs: dict[str, dict[str, object]] = {}
    for label, image in (("noisy", noisy), ("reference", reference)):
        target = args.output_root / f"{args.stem}-{label}.f32"
        nchw = np.ascontiguousarray(np.transpose(image, (2, 0, 1)), dtype="<f4")
        nchw.tofile(target)
        outputs[label] = {
            "file": target.name,
            "bytes": target.stat().st_size,
            "sha256": sha256(target),
        }

    manifest = {
        "version": 1,
        "renderer": "procedural-cornell-mc-v1",
        "split": "val",
        "stem": args.stem,
        "sceneSeed": args.scene_seed,
        "shape": [1, 3, int(noisy.shape[0]), int(noisy.shape[1])],
        "dtype": "float32-le",
        "noisySamplesPerPixel": 1,
        "referenceSamplesPerPixel": 64,
        "layout": "NCHW",
        "files": outputs,
    }
    manifest_path = args.output_root / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(manifest_path)


if __name__ == "__main__":
    main()
