#!/usr/bin/env python3
'''Convert the public reviewed held-out Float32 NCHW artifacts to IEEE Float16.

The source files remain readable until this command verifies every converted
artifact and rewrites the manifest atomically. The conversion only rounds
storage precision; split, seed, renderer, and source provenance are preserved.
'''

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np


def descriptor(path: Path) -> dict[str, object]:
    return {
        'file': path.name,
        'bytes': path.stat().st_size,
        'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--heldout-root', type=Path, required=True)
    args = parser.parse_args()
    root = args.heldout_root.resolve()
    manifest_path = root / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    if manifest.get('dtype') != 'float32-le' or manifest.get('shape') != [1, 3, 256, 256]:
        raise ValueError('Expected the reviewed Float32 1x3x256x256 held-out manifest')

    expected_values = 3 * 256 * 256
    for key in ('noisy', 'reference', 'albedo', 'worldNormal', 'guidedCandidate'):
        entry = manifest.get('files', {}).get(key)
        if not isinstance(entry, dict) or not str(entry.get('file', '')).endswith('.f32'):
            raise ValueError(f'Missing Float32 source artifact for {key}')
        source = root / str(entry['file'])
        values = np.fromfile(source, dtype='<f4')
        if values.size != expected_values or not np.isfinite(values).all():
            raise ValueError(f'Invalid Float32 source artifact for {key}')
        target = source.with_suffix('.f16')
        values.astype('<f2').tofile(target)
        if target.stat().st_size != expected_values * 2:
            raise RuntimeError(f'Float16 pack length is invalid for {key}')
        manifest['files'][key] = descriptor(target)

    manifest['dtype'] = 'float16-le'
    manifest_path.write_bytes((json.dumps(manifest, indent=2) + '\n').encode('utf-8'))
    print(manifest_path)


if __name__ == '__main__':
    main()
