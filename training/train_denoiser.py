#!/usr/bin/env python3
"""Train the portfolio's small eight-convolution residual denoiser.

The script is deliberately local-only: it reads an existing paired dataset and
never downloads data or creates synthetic checkpoints.  See README.md for the
expected directory layout.
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path
from typing import Iterable

import numpy as np
import torch
from torch import Tensor, nn
from torch.utils.data import DataLoader, Dataset


class ResidualBlock(nn.Module):
    """Two convolutional layers with a local residual connection."""

    def __init__(self, channels: int) -> None:
        super().__init__()
        self.body = nn.Sequential(
            nn.Conv2d(channels, channels, kernel_size=3, padding=1),
            nn.ReLU(inplace=True),
            nn.Conv2d(channels, channels, kernel_size=3, padding=1),
        )

    def forward(self, x: Tensor) -> Tensor:
        return x + self.body(x)


class ResidualDenoiser(nn.Module):
    """Small RGB residual CNN with exactly eight Conv2d layers.

    Layer count: one stem + two convolutions in each of three residual blocks
    + one output head = eight convolutional layers.  The network predicts a
    residual which is added to the noisy input, then bounded to [0, 1].
    """

    conv_layers = 8

    def __init__(self, channels: int = 3, features: int = 32) -> None:
        super().__init__()
        self.stem = nn.Sequential(
            nn.Conv2d(channels, features, kernel_size=3, padding=1),
            nn.ReLU(inplace=True),
        )
        self.blocks = nn.Sequential(
            ResidualBlock(features),
            ResidualBlock(features),
            ResidualBlock(features),
        )
        self.head = nn.Conv2d(features, channels, kernel_size=3, padding=1)
        # Start as an exact identity mapping. This prevents an untrained
        # residual head from being worse than the noisy input and makes any
        # published gain attributable to learned residuals.
        nn.init.zeros_(self.head.weight)
        nn.init.zeros_(self.head.bias)

    def forward(self, noisy: Tensor) -> Tensor:
        residual = self.head(self.blocks(self.stem(noisy)))
        return torch.clamp(noisy + residual, 0.0, 1.0)


def _npy_files(directory: Path) -> dict[str, Path]:
    files = {path.stem: path for path in directory.glob("*.npy")}
    if not files:
        raise FileNotFoundError(f"No .npy files found in {directory}")
    return files


def _as_chw(path: Path) -> Tensor:
    array = np.load(path, allow_pickle=False)
    if array.dtype.kind not in "fiu":
        raise ValueError(f"{path} must contain a numeric array")
    if array.ndim != 3:
        raise ValueError(f"{path} must be HxWxC or CxHxW, got {array.shape}")
    if array.shape[-1] == 3:
        array = np.transpose(array, (2, 0, 1))
    elif array.shape[0] != 3:
        raise ValueError(f"{path} must have three RGB channels, got {array.shape}")
    tensor = torch.from_numpy(np.ascontiguousarray(array)).float()
    if not torch.isfinite(tensor).all() or tensor.min() < 0.0 or tensor.max() > 1.0:
        raise ValueError(f"{path} values must be finite and normalized to [0, 1]")
    return tensor


class PairedNpyDataset(Dataset[tuple[Tensor, Tensor]]):
    """Paired local noisy/clean .npy images with deterministic-size crops."""

    def __init__(
        self,
        noisy_dir: Path,
        clean_dir: Path,
        patch_size: int,
        augment: bool,
    ) -> None:
        noisy = _npy_files(noisy_dir)
        clean = _npy_files(clean_dir)
        names = sorted(noisy.keys() & clean.keys())
        if not names:
            raise ValueError(f"No matching noisy/clean stems in {noisy_dir} and {clean_dir}")
        missing_clean = sorted(noisy.keys() - clean.keys())
        missing_noisy = sorted(clean.keys() - noisy.keys())
        if missing_clean or missing_noisy:
            raise ValueError(
                "Paired dataset has unmatched files: "
                f"missing clean={missing_clean[:3]}, missing noisy={missing_noisy[:3]}"
            )
        if patch_size < 16:
            raise ValueError("patch_size must be at least 16")
        self.pairs = [(noisy[name], clean[name]) for name in names]
        self.patch_size = patch_size
        self.augment = augment

    def __len__(self) -> int:
        return len(self.pairs)

    def __getitem__(self, index: int) -> tuple[Tensor, Tensor]:
        noisy = _as_chw(self.pairs[index][0])
        clean = _as_chw(self.pairs[index][1])
        if noisy.shape != clean.shape:
            raise ValueError(f"Pair shape mismatch: {self.pairs[index]} -> {noisy.shape} vs {clean.shape}")
        _, height, width = noisy.shape
        if height < self.patch_size or width < self.patch_size:
            raise ValueError(
                f"Pair {self.pairs[index][0].name} is smaller than patch size "
                f"{self.patch_size}: {(height, width)}"
            )
        top = random.randint(0, height - self.patch_size)
        left = random.randint(0, width - self.patch_size)
        noisy = noisy[:, top : top + self.patch_size, left : left + self.patch_size]
        clean = clean[:, top : top + self.patch_size, left : left + self.patch_size]
        if self.augment and random.random() < 0.5:
            noisy = torch.flip(noisy, dims=(2,))
            clean = torch.flip(clean, dims=(2,))
        if self.augment and random.random() < 0.5:
            noisy = torch.flip(noisy, dims=(1,))
            clean = torch.flip(clean, dims=(1,))
        return noisy, clean


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, required=True, help="Local dataset root; no network access is used")
    parser.add_argument("--output", type=Path, default=Path("training/checkpoints/denoiser.pt"))
    parser.add_argument("--patch-size", type=int, default=256)
    parser.add_argument("--features", type=int, default=32)
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--epochs", type=int, default=40)
    parser.add_argument("--learning-rate", type=float, default=1e-3)
    parser.add_argument("--workers", type=int, default=0)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--device", choices=("auto", "cpu", "cuda"), default="auto")
    return parser.parse_args()


def _device(name: str) -> torch.device:
    if name == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("--device cuda was requested but CUDA is unavailable")
    if name == "auto":
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")
    return torch.device(name)


def _run_epoch(
    model: nn.Module,
    loader: Iterable[tuple[Tensor, Tensor]],
    criterion: nn.Module,
    device: torch.device,
    optimizer: torch.optim.Optimizer | None,
) -> float:
    training = optimizer is not None
    model.train(training)
    total = 0.0
    count = 0
    for noisy, clean in loader:
        noisy = noisy.to(device, non_blocking=True)
        clean = clean.to(device, non_blocking=True)
        with torch.set_grad_enabled(training):
            prediction = model(noisy)
            loss = criterion(prediction, clean)
            if training:
                optimizer.zero_grad(set_to_none=True)
                loss.backward()
                optimizer.step()
        total += loss.item() * noisy.shape[0]
        count += noisy.shape[0]
    if count == 0:
        raise RuntimeError("Dataset yielded no samples")
    return total / count


def main() -> None:
    args = _parse_args()
    if args.epochs <= 0 or args.batch_size <= 0:
        raise ValueError("epochs and batch-size must be positive")
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)

    root = args.data_root.resolve()
    train = PairedNpyDataset(root / "train" / "noisy", root / "train" / "clean", args.patch_size, augment=True)
    validation = PairedNpyDataset(root / "val" / "noisy", root / "val" / "clean", args.patch_size, augment=False)
    train_loader = DataLoader(train, batch_size=args.batch_size, shuffle=True, num_workers=args.workers)
    validation_loader = DataLoader(validation, batch_size=args.batch_size, shuffle=False, num_workers=args.workers)

    device = _device(args.device)
    model = ResidualDenoiser(features=args.features).to(device)
    criterion = nn.L1Loss()
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate)
    best = float("inf")
    history: list[dict[str, float | int]] = []

    for epoch in range(1, args.epochs + 1):
        train_loss = _run_epoch(model, train_loader, criterion, device, optimizer)
        val_loss = _run_epoch(model, validation_loader, criterion, device, None)
        history.append({"epoch": epoch, "train_l1": train_loss, "val_l1": val_loss})
        print(f"epoch {epoch:03d} train_l1={train_loss:.6f} val_l1={val_loss:.6f}")
        if val_loss < best:
            best = val_loss
            args.output.parent.mkdir(parents=True, exist_ok=True)
            torch.save(
                {
                    "state_dict": model.state_dict(),
                    "architecture": "ResidualDenoiser-8conv",
                    "channels": 3,
                    "features": args.features,
                    "input_shape": [1, 3, args.patch_size, args.patch_size],
                    "normalization": "RGB float32 in [0, 1]",
                    "best_val_l1": best,
                    "history": history,
                },
                args.output,
            )

    print(json.dumps({"checkpoint": str(args.output), "best_val_l1": best}, ensure_ascii=False))


if __name__ == "__main__":
    main()
