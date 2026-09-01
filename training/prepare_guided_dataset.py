#!/usr/bin/env python3
'''Pack deterministic noisy RGB, albedo RGB, and world normal XYZ inputs.

The script uses the same procedural scene and primary-ray sequence as the
generator's first noisy sample. It copies clean targets and dataset provenance
unchanged into a separate ignored training root; it never alters source pairs.
'''

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import numpy as np

from generate_dataset import _plane_hits, _sample_rays, _sphere_hits, make_context, make_scene


def guide_image(size: int, split: str, index: int, seed: int) -> tuple[np.ndarray, np.ndarray]:
    context = make_context(size)
    scene = make_scene(split, index, seed)
    rng = np.random.Generator(np.random.PCG64(seed * 17 + 11))
    origins, directions = _sample_rays(context, rng)
    plane_t, plane_n, plane_albedo = _plane_hits(origins, directions, scene)
    sphere_t, sphere_n, sphere_albedo, _, _ = _sphere_hits(origins, directions, scene)
    sphere_is_nearer = sphere_t < plane_t
    hit_t = np.where(sphere_is_nearer, sphere_t, plane_t)
    normals = np.where(sphere_is_nearer[:, None], sphere_n, plane_n)
    albedo = np.where(sphere_is_nearer[:, None], sphere_albedo, plane_albedo)
    hit = np.isfinite(hit_t)
    albedo[~hit] = np.asarray(scene.environment, dtype=np.float32)
    normals[~hit] = np.array((0.0, 0.0, 1.0), dtype=np.float32)
    return (
        np.clip(albedo.reshape(size, size, 3), 0.0, 1.0).astype(np.float32),
        np.clip(normals.reshape(size, size, 3) * 0.5 + 0.5, 0.0, 1.0).astype(np.float32),
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, required=True)
    parser.add_argument('--output-root', type=Path, required=True)
    args = parser.parse_args()
    source = args.source_root.resolve()
    output = args.output_root.resolve()
    manifest = json.loads((source / 'dataset-manifest.json').read_text(encoding='utf-8'))
    if manifest.get('shape', [0, 0, 0])[2] != 3:
        raise ValueError('Expected an HxWx3 generated source dataset')
    size = int(manifest['shape'][0])
    records = manifest.get('records', [])
    for record in records:
        stem = record['stem']
        scene = record['scene']
        split = scene['split']
        noisy = np.load(source / split / 'noisy' / (stem + '.npy'), allow_pickle=False)
        clean = np.load(source / split / 'clean' / (stem + '.npy'), allow_pickle=False)
        albedo, normals = guide_image(size, split, int(scene['index']), int(scene['seed']))
        packed = np.concatenate((noisy, albedo, normals), axis=2).astype(np.float32)
        target_noisy = output / split / 'noisy' / (stem + '.npy')
        target_clean = output / split / 'clean' / (stem + '.npy')
        target_noisy.parent.mkdir(parents=True, exist_ok=True)
        target_clean.parent.mkdir(parents=True, exist_ok=True)
        np.save(target_noisy, packed, allow_pickle=False)
        shutil.copyfile(source / split / 'clean' / (stem + '.npy'), target_clean)
        if clean.shape[:2] != packed.shape[:2]:
            raise ValueError('Guided pack lost spatial alignment')
    guided_manifest = {
        'source_dataset_manifest': str((source / 'dataset-manifest.json').resolve()),
        'source_dataset_manifest_sha256': __import__('hashlib').sha256(
            (source / 'dataset-manifest.json').read_bytes()
        ).hexdigest(),
        'input_layout': 'noisy_rgb,albedo_rgb,world_normal_remapped',
        'input_shape': [size, size, 9],
        'records': len(records),
    }
    output.mkdir(parents=True, exist_ok=True)
    (output / 'guided-pack-manifest.json').write_text(
        json.dumps(guided_manifest, indent=2) + '\n', encoding='utf-8'
    )
    print(json.dumps({'output_root': str(output), 'records': len(records)}))


if __name__ == '__main__':
    main()
