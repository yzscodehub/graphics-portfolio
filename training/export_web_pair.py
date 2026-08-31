"""Export one reviewed validation pair as browser-ready NCHW float32 assets.

The script preserves source-dataset and public-asset names separately. The
reviewed generator names the first validation scene ``scene-0064`` because it
follows 64 training scenes; the published browser asset keeps the stable
``scene-0001`` prefix. Both identities and the source manifest hash are stored
in the output manifest so the alias is auditable rather than implicit.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np


EXPORT_VERSION = "reviewed-web-pair-v2"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_source_record(dataset_manifest: Path, source_stem: str, scene_seed: int) -> dict[str, Any]:
    if not dataset_manifest.is_file():
        raise FileNotFoundError(f"Dataset manifest does not exist: {dataset_manifest}")
    try:
        document = json.loads(dataset_manifest.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"Dataset manifest is not valid JSON: {dataset_manifest}") from error
    if document.get("renderer") != "procedural-cornell-mc-v1":
        raise ValueError("Dataset manifest renderer is not procedural-cornell-mc-v1")
    matches = [record for record in document.get("records", []) if record.get("stem") == source_stem]
    if len(matches) != 1:
        raise ValueError(f"Dataset manifest must contain exactly one record for {source_stem}")
    scene = matches[0].get("scene")
    if not isinstance(scene, dict) or scene.get("split") != "val":
        raise ValueError(f"{source_stem} is not recorded as a validation scene")
    if scene.get("seed") != scene_seed:
        raise ValueError(
            f"{source_stem} seed mismatch: manifest has {scene.get('seed')}, expected {scene_seed}"
        )
    return document


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset-root", type=Path, required=True)
    parser.add_argument("--dataset-manifest", type=Path, help="Defaults to <dataset-root>/dataset-manifest.json")
    parser.add_argument("--source-stem", default="scene-0064", help="Validation .npy stem from generate_dataset.py")
    parser.add_argument("--asset-stem", default="scene-0001", help="Stable browser asset prefix")
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--scene-seed", type=int, default=91_103)
    args = parser.parse_args()
    if not args.source_stem or not args.asset_stem:
        raise ValueError("source-stem and asset-stem must be non-empty")

    dataset_root = args.dataset_root.resolve()
    dataset_manifest = (args.dataset_manifest or dataset_root / "dataset-manifest.json").resolve()
    source_document = _load_source_record(dataset_manifest, args.source_stem, args.scene_seed)
    noisy = np.load(dataset_root / "val/noisy" / f"{args.source_stem}.npy", allow_pickle=False)
    reference = np.load(dataset_root / "val/clean" / f"{args.source_stem}.npy", allow_pickle=False)
    if noisy.shape != reference.shape or noisy.ndim != 3 or noisy.shape[2] != 3:
        raise ValueError(f"Expected matching HxWx3 arrays, got {noisy.shape} and {reference.shape}")
    if noisy.dtype != np.float32 or reference.dtype != np.float32:
        raise ValueError("Reviewed browser pair must remain float32")
    if not np.isfinite(noisy).all() or not np.isfinite(reference).all():
        raise ValueError("Reviewed browser pair contains non-finite values")

    output_root = args.output_root.resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    outputs: dict[str, dict[str, object]] = {}
    for label, image in (("noisy", noisy), ("reference", reference)):
        target = output_root / f"{args.asset_stem}-{label}.f32"
        nchw = np.ascontiguousarray(np.transpose(image, (2, 0, 1)), dtype="<f4")
        nchw.tofile(target)
        outputs[label] = {
            "file": target.name,
            "bytes": target.stat().st_size,
            "sha256": sha256(target),
        }

    manifest = {
        "version": 1,
        "renderer": source_document["renderer"],
        "split": "val",
        "stem": args.asset_stem,
        "sceneSeed": args.scene_seed,
        "export": {
            "version": EXPORT_VERSION,
            "assetStem": args.asset_stem,
            "sourceDatasetStem": args.source_stem,
            "datasetManifestSha256": sha256(dataset_manifest),
        },
        "shape": [1, 3, int(noisy.shape[0]), int(noisy.shape[1])],
        "dtype": "float32-le",
        "noisySamplesPerPixel": 1,
        "referenceSamplesPerPixel": 64,
        "layout": "NCHW",
        "files": outputs,
    }
    manifest_path = output_root / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(manifest_path)


if __name__ == "__main__":
    main()
