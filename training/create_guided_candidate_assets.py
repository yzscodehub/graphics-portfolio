#!/usr/bin/env python3
'''Create static, hash-bound guidance artifacts for the unreviewed Guided candidate.

This utility deliberately does not train, export, or claim an ONNX model.  It
derives procedural albedo and world-normal guides plus an edge-aware static
candidate from the public noisy input.  The candidate must remain marked
'candidate' until a reviewed 9-channel training/evaluation record replaces it.
'''

from __future__ import annotations

import argparse
import array
import hashlib
import json
import math
from pathlib import Path

import numpy as np


def digest(path: Path) -> dict[str, object]:
    return {
        'file': path.name,
        'bytes': path.stat().st_size,
        'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
    }


def read_float16(path: Path) -> array.array:
    values = np.fromfile(path, dtype='<f2').astype(np.float32)
    return array.array('f', values.tolist())


def write_float16(path: Path, values: array.array) -> None:
    np.asarray(values, dtype='<f2').tofile(path)


def clamp(value: float) -> float:
    return max(0.0, min(1.0, value))


def generate(noisy: array.array, side: int) -> tuple[array.array, array.array, array.array]:
    plane = side * side
    albedo = array.array('f', [0.0]) * (plane * 3)
    normals = array.array('f', [0.0]) * (plane * 3)
    candidate = array.array('f', [0.0]) * (plane * 3)
    for y in range(side):
        for x in range(side):
            u = x / max(side - 1, 1)
            v = y / max(side - 1, 1)
            pixel = y * side + x
            tile = 0.15 if ((x // 32) + (y // 32)) % 2 else 0.0
            albedo[pixel] = 0.22 + tile
            albedo[plane + pixel] = 0.42 + 0.25 * u
            albedo[2 * plane + pixel] = 0.28 + 0.20 * v
            nx = (u - 0.52) * 1.6
            ny = (v - 0.50) * 1.6
            nz = math.sqrt(max(0.0, 1.0 - nx * nx - ny * ny))
            normals[pixel] = clamp(nx * 0.5 + 0.5)
            normals[plane + pixel] = clamp(ny * 0.5 + 0.5)
            normals[2 * plane + pixel] = clamp(nz * 0.5 + 0.5)

    for channel in range(3):
        offset = channel * plane
        for y in range(side):
            for x in range(side):
                pixel = y * side + x
                center = noisy[offset + pixel]
                total = center * 4.0
                weight = 4.0
                for ox, oy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                    sx = max(0, min(side - 1, x + ox))
                    sy = max(0, min(side - 1, y + oy))
                    sample = sy * side + sx
                    guide_delta = abs(albedo[pixel] - albedo[sample]) + abs(normals[pixel] - normals[sample])
                    neighbor_weight = 1.0 / (1.0 + guide_delta * 8.0)
                    total += noisy[offset + sample] * neighbor_weight
                    weight += neighbor_weight
                candidate[offset + pixel] = clamp(total / weight)
    return albedo, normals, candidate


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--heldout-root', type=Path, required=True)
    args = parser.parse_args()
    root = args.heldout_root.resolve()
    manifest_path = root / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    if manifest.get('version') not in (1, 2) or manifest.get('shape') != [1, 3, 256, 256]:
        raise ValueError('Expected the reviewed 1x3x256x256 held-out browser pair')
    noisy_entry = manifest.get('files', {}).get('noisy')
    if not isinstance(noisy_entry, dict) or noisy_entry.get('file') != 'scene-0001-noisy.f16':
        raise ValueError('Expected the reviewed scene-0001 noisy artifact')
    noisy = read_float16(root / noisy_entry['file'])
    if len(noisy) != 3 * 256 * 256:
        raise ValueError('Noisy artifact length does not match the fixed browser contract')

    albedo, normals, candidate = generate(noisy, 256)
    albedo_path = root / 'scene-0001-albedo.f16'
    normal_path = root / 'scene-0001-world-normal.f16'
    candidate_path = root / 'scene-0001-guided-static-candidate.f16'
    write_float16(albedo_path, albedo)
    write_float16(normal_path, normals)
    write_float16(candidate_path, candidate)

    manifest['version'] = 2
    manifest['dtype'] = 'float16-le'
    manifest['guidance'] = {
        'albedoSpace': 'linear-rgb',
        'worldNormalEncoding': 'xyz-remapped-[0,1]',
    }
    manifest['files']['albedo'] = digest(albedo_path)
    manifest['files']['worldNormal'] = digest(normal_path)
    manifest['files']['guidedCandidate'] = digest(candidate_path)
    manifest_path.write_bytes((json.dumps(manifest, indent=2) + '\n').encode('utf-8'))
    print(manifest_path)


if __name__ == '__main__':
    main()
