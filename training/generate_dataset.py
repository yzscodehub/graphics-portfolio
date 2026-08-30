#!/usr/bin/env python3
"""Generate deterministic, local paired RGB data for the denoising experiment.

The renderer is deliberately small and pedagogical.  It traces primary rays
against a procedural Cornell-style room and spheres, then estimates direct
illumination from a rectangular area light with Monte Carlo sampling.  A low
sample estimate is the noisy input; a higher sample estimate is the clean
reference.  It is *path-tracing-style* data, not a production renderer or a
ground-truth benchmark.

No assets are downloaded.  The caller explicitly chooses the output root,
which follows the directory layout consumed by train_denoiser.py:

    <output-root>/train/{noisy,clean}/scene-0000.npy
    <output-root>/val/{noisy,clean}/scene-0064.npy
"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Literal

import numpy as np


RENDERER_VERSION = "procedural-cornell-mc-v1"
EPSILON = np.float32(1e-4)


def _normalize(vectors: np.ndarray) -> np.ndarray:
    """Return row-normalized vectors without introducing NaNs."""

    finite = np.nan_to_num(vectors, nan=0.0, posinf=0.0, neginf=0.0)
    lengths = np.linalg.norm(finite, axis=-1, keepdims=True)
    result = np.zeros_like(finite)
    np.divide(finite, np.maximum(lengths, np.float32(1e-8)), out=result, where=lengths > np.float32(1e-8))
    return result


@dataclass(frozen=True)
class Sphere:
    center: tuple[float, float, float]
    radius: float
    albedo: tuple[float, float, float]
    metallic: float
    roughness: float


@dataclass(frozen=True)
class Scene:
    split: Literal["train", "val"]
    index: int
    seed: int
    family: str
    wall_left: tuple[float, float, float]
    wall_right: tuple[float, float, float]
    back_wall: tuple[float, float, float]
    floor: tuple[float, float, float]
    environment: tuple[float, float, float]
    light_center: tuple[float, float, float]
    light_size: tuple[float, float]
    light_radiance: tuple[float, float, float]
    spheres: tuple[Sphere, ...]


@dataclass(frozen=True)
class RenderContext:
    height: int
    width: int
    grid_x: np.ndarray
    grid_y: np.ndarray
    camera_origin: np.ndarray
    camera_forward: np.ndarray
    camera_right: np.ndarray
    camera_up: np.ndarray
    tan_half_fov: np.float32
    aspect_ratio: np.float32


def _rgb(rng: np.random.Generator, low: float, high: float) -> tuple[float, float, float]:
    return tuple(float(value) for value in rng.uniform(low, high, size=3))


def make_scene(split: Literal["train", "val"], index: int, seed: int) -> Scene:
    """Create a reproducible room, material, sphere, and light configuration."""

    rng = np.random.Generator(np.random.PCG64(seed))
    families = ("cornell", "cool-studio", "warm-studio")
    family = families[index % len(families)]
    if family == "cornell":
        wall_left = (0.68, 0.15, 0.12)
        wall_right = (0.12, 0.43, 0.33)
        back_wall = (0.52, 0.51, 0.47)
        environment = (0.020, 0.022, 0.018)
    elif family == "cool-studio":
        wall_left = (0.15, 0.27, 0.55)
        wall_right = (0.22, 0.48, 0.55)
        back_wall = (0.34, 0.38, 0.46)
        environment = (0.014, 0.022, 0.035)
    else:
        wall_left = (0.52, 0.24, 0.12)
        wall_right = (0.54, 0.35, 0.16)
        back_wall = (0.47, 0.37, 0.30)
        environment = (0.033, 0.020, 0.012)

    # Small, bounded variations stop the dataset from being seven copies of a
    # single room while keeping all geometry visible to the fixed camera.
    wall_scale = float(rng.uniform(0.82, 1.14))
    wall_left = tuple(float(np.clip(value * wall_scale, 0.02, 0.95)) for value in wall_left)
    wall_right = tuple(float(np.clip(value * wall_scale, 0.02, 0.95)) for value in wall_right)
    back_wall = tuple(float(np.clip(value * wall_scale, 0.02, 0.95)) for value in back_wall)
    floor = _rgb(rng, 0.30, 0.54)

    sphere_count = int(rng.integers(2, 5))
    spheres: list[Sphere] = []
    for sphere_index in range(sphere_count):
        # Rejection sampling keeps spheres separated enough for readable
        # silhouettes and meaningful hard shadows.
        for _ in range(32):
            radius = float(rng.uniform(0.28, 0.58))
            center = np.array(
                [
                    rng.uniform(-1.28, 1.28),
                    -1.20 + radius,
                    rng.uniform(-2.85, -0.72),
                ],
                dtype=np.float32,
            )
            if all(np.linalg.norm(center - np.asarray(existing.center)) > radius + existing.radius + 0.12 for existing in spheres):
                break
        else:
            # The deterministic fallback remains valid even for an unlucky
            # random sequence and does not influence prior scenes.
            radius = 0.34
            center = np.array((-0.85 + sphere_index * 0.55, -0.86, -1.55), dtype=np.float32)
        albedo = _rgb(rng, 0.12, 0.88)
        spheres.append(
            Sphere(
                center=tuple(float(value) for value in center),
                radius=radius,
                albedo=albedo,
                metallic=float(rng.uniform(0.0, 0.75)),
                roughness=float(rng.uniform(0.16, 0.82)),
            )
        )

    light_center = (
        float(rng.uniform(-0.35, 0.35)),
        float(rng.uniform(1.30, 1.72)),
        float(rng.uniform(-2.15, -1.10)),
    )
    light_size = (float(rng.uniform(0.68, 1.15)), float(rng.uniform(0.52, 0.95)))
    radiance = tuple(float(value) for value in rng.uniform(8.5, 16.0, size=3))
    return Scene(
        split=split,
        index=index,
        seed=seed,
        family=family,
        wall_left=wall_left,
        wall_right=wall_right,
        back_wall=back_wall,
        floor=floor,
        environment=environment,
        light_center=light_center,
        light_size=light_size,
        light_radiance=radiance,
        spheres=tuple(spheres),
    )


def make_context(size: int) -> RenderContext:
    if size < 16:
        raise ValueError("--size must be at least 16")
    pixel_y, pixel_x = np.mgrid[0:size, 0:size]
    origin = np.array((0.0, 0.10, 3.85), dtype=np.float32)
    target = np.array((0.0, -0.32, -1.72), dtype=np.float32)
    forward = _normalize((target - origin)[None, :])[0].astype(np.float32)
    right = _normalize(np.cross(forward, np.array((0.0, 1.0, 0.0), dtype=np.float32))[None, :])[0].astype(np.float32)
    up = _normalize(np.cross(right, forward)[None, :])[0].astype(np.float32)
    return RenderContext(
        height=size,
        width=size,
        grid_x=pixel_x.astype(np.float32),
        grid_y=pixel_y.astype(np.float32),
        camera_origin=origin,
        camera_forward=forward,
        camera_right=right,
        camera_up=up,
        tan_half_fov=np.float32(np.tan(np.deg2rad(36.0) / 2.0)),
        aspect_ratio=np.float32(1.0),
    )


def _plane_hits(origins: np.ndarray, directions: np.ndarray, scene: Scene) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Intersect the floor and three Cornell-style walls."""

    count = origins.shape[0]
    distances = np.full((count, 4), np.inf, dtype=np.float32)
    normals = np.zeros((count, 4, 3), dtype=np.float32)
    albedos = np.zeros((count, 4, 3), dtype=np.float32)
    plane_specs = (
        (1, -1.20, np.array((0.0, 1.0, 0.0), dtype=np.float32), np.asarray(scene.floor, dtype=np.float32)),
        (2, -3.85, np.array((0.0, 0.0, 1.0), dtype=np.float32), np.asarray(scene.back_wall, dtype=np.float32)),
        (0, -2.05, np.array((1.0, 0.0, 0.0), dtype=np.float32), np.asarray(scene.wall_left, dtype=np.float32)),
        (0, 2.05, np.array((-1.0, 0.0, 0.0), dtype=np.float32), np.asarray(scene.wall_right, dtype=np.float32)),
    )
    for column, (axis, coordinate, normal, albedo) in enumerate(plane_specs):
        denominator = directions[:, axis]
        valid = np.abs(denominator) > EPSILON
        t = np.full(count, np.inf, dtype=np.float32)
        t[valid] = (coordinate - origins[valid, axis]) / denominator[valid]
        t[t <= EPSILON] = np.inf
        safe_t = np.where(np.isfinite(t), t, np.float32(0.0))
        points = origins + directions * safe_t[:, None]
        # Keep intersections within the finite room.  The ceiling is open so
        # the sampled area light has an unobstructed path into the scene.
        in_room = (np.abs(points[:, 0]) <= 2.05 + EPSILON) & (points[:, 1] >= -1.20 - EPSILON) & (points[:, 1] <= 1.82) & (points[:, 2] >= -3.85 - EPSILON) & (points[:, 2] <= 3.90)
        t[~in_room] = np.inf
        distances[:, column] = t
        normals[:, column, :] = normal
        albedos[:, column, :] = albedo
    nearest = np.argmin(distances, axis=1)
    return distances[np.arange(count), nearest], normals[np.arange(count), nearest], albedos[np.arange(count), nearest]


def _sphere_hits(origins: np.ndarray, directions: np.ndarray, scene: Scene) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Return nearest analytic sphere hit and material properties per ray."""

    count = origins.shape[0]
    if not scene.spheres:
        empty = np.full(count, np.inf, dtype=np.float32)
        return empty, np.zeros((count, 3), dtype=np.float32), np.zeros((count, 3), dtype=np.float32), np.zeros(count, dtype=np.float32), np.ones(count, dtype=np.float32)
    centers = np.asarray([sphere.center for sphere in scene.spheres], dtype=np.float32)
    radii = np.asarray([sphere.radius for sphere in scene.spheres], dtype=np.float32)
    offset = origins[:, None, :] - centers[None, :, :]
    b = np.sum(directions[:, None, :] * offset, axis=-1)
    c = np.sum(offset * offset, axis=-1) - radii[None, :] * radii[None, :]
    discriminant = b * b - c
    root = np.sqrt(np.maximum(discriminant, 0.0)).astype(np.float32)
    nearest = -b - root
    nearest[(discriminant <= 0.0) | (nearest <= EPSILON)] = np.inf
    sphere_indices = np.argmin(nearest, axis=1)
    distances = nearest[np.arange(count), sphere_indices]
    valid_hits = np.isfinite(distances)
    safe_distances = np.where(valid_hits, distances, np.float32(0.0))
    hit_points = origins + directions * safe_distances[:, None]
    normals = _normalize(hit_points - centers[sphere_indices]).astype(np.float32)
    normals[~valid_hits] = 0.0
    albedos = np.asarray([sphere.albedo for sphere in scene.spheres], dtype=np.float32)[sphere_indices]
    metallic = np.asarray([sphere.metallic for sphere in scene.spheres], dtype=np.float32)[sphere_indices]
    roughness = np.asarray([sphere.roughness for sphere in scene.spheres], dtype=np.float32)[sphere_indices]
    return distances, normals, albedos, metallic, roughness


def _sphere_shadowed(points: np.ndarray, directions: np.ndarray, max_distances: np.ndarray, scene: Scene) -> np.ndarray:
    """Test hard shadows from spheres; room planes cannot block the open light."""

    if not scene.spheres:
        return np.zeros(points.shape[0], dtype=bool)
    centers = np.asarray([sphere.center for sphere in scene.spheres], dtype=np.float32)
    radii = np.asarray([sphere.radius for sphere in scene.spheres], dtype=np.float32)
    offset = points[:, None, :] - centers[None, :, :]
    b = np.sum(directions[:, None, :] * offset, axis=-1)
    c = np.sum(offset * offset, axis=-1) - radii[None, :] * radii[None, :]
    discriminant = b * b - c
    t = -b - np.sqrt(np.maximum(discriminant, 0.0)).astype(np.float32)
    return np.any((discriminant > 0.0) & (t > EPSILON) & (t < max_distances[:, None] - EPSILON), axis=1)


def _sample_rays(context: RenderContext, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    jitter = rng.random((context.height, context.width, 2), dtype=np.float32) - np.float32(0.5)
    ndc_x = ((context.grid_x + np.float32(0.5) + jitter[..., 0]) / context.width) * np.float32(2.0) - np.float32(1.0)
    ndc_y = np.float32(1.0) - ((context.grid_y + np.float32(0.5) + jitter[..., 1]) / context.height) * np.float32(2.0)
    directions = context.camera_forward + ndc_x[..., None] * context.camera_right * context.tan_half_fov * context.aspect_ratio + ndc_y[..., None] * context.camera_up * context.tan_half_fov
    directions = _normalize(directions.reshape(-1, 3)).astype(np.float32)
    origins = np.broadcast_to(context.camera_origin, directions.shape).copy()
    return origins, directions


def _render_sample(context: RenderContext, scene: Scene, rng: np.random.Generator) -> np.ndarray:
    origins, directions = _sample_rays(context, rng)
    plane_t, plane_n, plane_albedo = _plane_hits(origins, directions, scene)
    sphere_t, sphere_n, sphere_albedo, metallic, roughness = _sphere_hits(origins, directions, scene)
    sphere_is_nearer = sphere_t < plane_t
    hit_t = np.where(sphere_is_nearer, sphere_t, plane_t)
    normals = np.where(sphere_is_nearer[:, None], sphere_n, plane_n)
    albedo = np.where(sphere_is_nearer[:, None], sphere_albedo, plane_albedo)
    metallic = np.where(sphere_is_nearer, metallic, np.float32(0.0))
    roughness = np.where(sphere_is_nearer, roughness, np.float32(0.95))
    hit_mask = np.isfinite(hit_t)
    safe_hit_t = np.where(hit_mask, hit_t, np.float32(0.0))
    points = origins + directions * safe_hit_t[:, None]

    light_u = rng.random(points.shape[0], dtype=np.float32) - np.float32(0.5)
    light_v = rng.random(points.shape[0], dtype=np.float32) - np.float32(0.5)
    light_center = np.asarray(scene.light_center, dtype=np.float32)
    light_points = light_center + np.stack(
        (light_u * np.float32(scene.light_size[0]), np.zeros_like(light_u), light_v * np.float32(scene.light_size[1])),
        axis=1,
    )
    to_light = light_points - points
    squared_distance = np.maximum(np.sum(to_light * to_light, axis=1), np.float32(1e-5))
    distance = np.sqrt(squared_distance).astype(np.float32)
    light_directions = to_light / distance[:, None]
    cosine_surface = np.clip(np.sum(normals * light_directions, axis=1), 0.0, 1.0)
    # Area lights face down.  This term is the light-side cosine required for
    # the area-measure estimator and deliberately provides visible variance.
    cosine_light = np.clip(-light_directions[:, 1], 0.0, 1.0)
    shadow_origin = points + normals * EPSILON
    shadowed = _sphere_shadowed(shadow_origin, light_directions, distance, scene)
    geometry = cosine_surface * cosine_light * np.float32(scene.light_size[0] * scene.light_size[1]) / squared_distance
    geometry[shadowed] = 0.0

    view = -directions
    half_vector = _normalize(view + light_directions)
    specular_power = 2.0 + (1.0 - roughness) * 96.0
    specular_lobe = np.power(np.clip(np.sum(normals * half_vector, axis=1), 0.0, 1.0), specular_power)
    diffuse = albedo * (1.0 - metallic[:, None]) / np.float32(np.pi)
    specular_color = np.full_like(albedo, 0.04) * (1.0 - metallic[:, None]) + albedo * metallic[:, None]
    direct = (diffuse + specular_color * specular_lobe[:, None]) * geometry[:, None] * np.asarray(scene.light_radiance, dtype=np.float32)
    # A deterministic, normal-weighted ambient term approximates one diffuse
    # bounce without pretending to perform full multi-bounce path tracing.
    ambient = albedo * np.asarray(scene.environment, dtype=np.float32) * (0.35 + 0.65 * np.clip(normals[:, 1:2], 0.0, 1.0))
    radiance = np.maximum(direct + ambient, 0.0).astype(np.float32)
    radiance[~hit_mask] = np.asarray(scene.environment, dtype=np.float32)
    return radiance.reshape(context.height, context.width, 3)


def render_estimate(context: RenderContext, scene: Scene, spp: int, seed: int) -> np.ndarray:
    """Average a deterministic linear-radiance Monte Carlo sequence to RGB."""

    if spp <= 0:
        raise ValueError("samples per pixel must be positive")
    rng = np.random.Generator(np.random.PCG64(seed))
    accumulator = np.zeros((context.height, context.width, 3), dtype=np.float32)
    for _ in range(spp):
        accumulator += _render_sample(context, scene, rng)
    radiance = accumulator / np.float32(spp)
    display = radiance / (1.0 + radiance)
    return np.power(display, 1.0 / 2.2).astype(np.float32)


def _write_pair(root: Path, split: Literal["train", "val"], stem: str, noisy: np.ndarray, clean: np.ndarray) -> None:
    for kind, image in (("noisy", noisy), ("clean", clean)):
        target = root / split / kind / f"{stem}.npy"
        target.parent.mkdir(parents=True, exist_ok=True)
        np.save(target, np.ascontiguousarray(image, dtype=np.float32), allow_pickle=False)


def _validate_output_root(root: Path, overwrite: bool) -> None:
    existing = list(root.glob("train/noisy/*.npy")) + list(root.glob("train/clean/*.npy")) + list(root.glob("val/noisy/*.npy")) + list(root.glob("val/clean/*.npy"))
    if existing and not overwrite:
        raise FileExistsError(f"{root} already contains generated pairs; pass --overwrite to replace matching stems")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-root", type=Path, required=True, help="Dataset root consumed by train_denoiser.py")
    parser.add_argument("--train-count", type=int, default=64, help="Number of deterministic training scenes (default: 64)")
    parser.add_argument("--val-count", type=int, default=16, help="Number of deterministic validation scenes (default: 16)")
    parser.add_argument("--size", type=int, default=256, help="Square image edge length (default: 256)")
    parser.add_argument("--noisy-spp", type=int, default=2, help="Low-sample input estimate per pixel (default: 2)")
    parser.add_argument("--clean-spp", type=int, default=16, help="Higher-sample reference estimate per pixel (default: 16)")
    parser.add_argument("--train-seed", type=int, default=7_301, help="First independent training scene seed")
    parser.add_argument("--val-seed", type=int, default=91_103, help="First independent validation scene seed")
    parser.add_argument("--overwrite", action="store_true", help="Allow replacement of matching generated .npy files")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.train_count <= 0 or args.val_count <= 0:
        raise ValueError("train-count and val-count must be positive")
    if args.noisy_spp <= 0 or args.clean_spp <= 0:
        raise ValueError("noisy-spp and clean-spp must be positive")
    if args.clean_spp <= args.noisy_spp:
        raise ValueError("clean-spp must be greater than noisy-spp")
    if args.train_seed == args.val_seed:
        raise ValueError("train-seed and val-seed must differ so the splits are disjoint")

    output_root = args.output_root.resolve()
    _validate_output_root(output_root, args.overwrite)
    context = make_context(args.size)
    jobs: list[tuple[Literal["train", "val"], int, int]] = []
    jobs.extend(("train", index, args.train_seed + index) for index in range(args.train_count))
    jobs.extend(("val", args.train_count + index, args.val_seed + index) for index in range(args.val_count))
    seen_seeds: set[int] = set()
    records: list[dict[str, object]] = []

    for number, (split, index, scene_seed) in enumerate(jobs, start=1):
        if scene_seed in seen_seeds:
            raise RuntimeError("Generated a duplicate scene seed")
        seen_seeds.add(scene_seed)
        scene = make_scene(split, index, scene_seed)
        # Separate sample-stream seeds ensure a true low- and high-sample
        # estimate rather than copying a portion of one estimate to the other.
        noisy = render_estimate(context, scene, args.noisy_spp, scene_seed * 17 + 11)
        clean = render_estimate(context, scene, args.clean_spp, scene_seed * 17 + 29)
        stem = f"scene-{index:04d}"
        _write_pair(output_root, split, stem, noisy, clean)
        records.append({"stem": stem, "scene": asdict(scene)})
        print(f"[{number:03d}/{len(jobs):03d}] {split}/{stem} family={scene.family} seed={scene_seed}")

    manifest = {
        "renderer": RENDERER_VERSION,
        "description": "Deterministic procedural Cornell-style Monte Carlo RGB pairs; no external assets.",
        "shape": [args.size, args.size, 3],
        "dtype": "float32",
        "color_pipeline": "linear radiance -> Reinhard tone map -> gamma 1/2.2 display RGB",
        "noisy_spp": args.noisy_spp,
        "clean_spp": args.clean_spp,
        "train_seed": args.train_seed,
        "val_seed": args.val_seed,
        "records": records,
    }
    output_root.mkdir(parents=True, exist_ok=True)
    (output_root / "dataset-manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"output_root": str(output_root), "train": args.train_count, "val": args.val_count, "shape": manifest["shape"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
