"""Datasets. Prepared layout: <root>/<set>/images/*.jpg and <root>/<set>/masks/*.png (same stems)."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import torch
from PIL import Image
from torch.utils.data import Dataset
from torchvision import tv_tensors
from torchvision.transforms import v2

from .composite import composite

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def list_images(folder: Path) -> list[Path]:
    return sorted(p for p in folder.iterdir() if p.suffix.lower() in IMAGE_EXTS)


def load_pairs(set_dir: Path) -> list[tuple[Path, Path]]:
    """Match images to masks by file stem; fail loudly if the set is empty or masks are missing."""
    images = list_images(set_dir / "images")
    masks = {p.stem: p for p in list_images(set_dir / "masks")}
    missing = [p.name for p in images if p.stem not in masks]
    if missing:
        raise FileNotFoundError(f"{len(missing)} images in {set_dir} have no mask, e.g. {missing[:3]}")
    if not images:
        raise FileNotFoundError(f"no images in {set_dir / 'images'}")
    return [(p, masks[p.stem]) for p in images]


def read_pair(image: Path, mask: Path) -> tuple[np.ndarray, np.ndarray]:
    img = np.asarray(Image.open(image).convert("RGB"))
    m = Image.open(mask).convert("L")
    if m.size != (img.shape[1], img.shape[0]):
        m = m.resize((img.shape[1], img.shape[0]), Image.BILINEAR)
    return img, np.asarray(m, dtype=np.float32) / 255


def make_transform(size: int, train: bool) -> v2.Compose:
    if train:
        steps = [
            v2.RandomResizedCrop(size, scale=(0.5, 1.0), ratio=(0.75, 1.33), antialias=True),
            v2.RandomHorizontalFlip(),
            v2.ColorJitter(0.3, 0.3, 0.3, 0.03),  # applies to the image only; masks pass through
        ]
    else:
        steps = [v2.Resize((size, size), antialias=True)]
    return v2.Compose([*steps, v2.ToDtype({tv_tensors.Image: torch.float32, "others": None}, scale=True)])


def to_tensors(img: np.ndarray, mask: np.ndarray, transform: v2.Compose) -> tuple[torch.Tensor, torch.Tensor]:
    image = tv_tensors.Image(torch.from_numpy(np.array(img)).permute(2, 0, 1))  # copy: PIL-backed arrays are read-only
    target = tv_tensors.Mask(torch.from_numpy(mask)[None])
    image, target = transform(image, target)
    return image.as_subclass(torch.Tensor), target.as_subclass(torch.Tensor).float()


class PairDataset(Dataset):
    def __init__(self, pairs: list[tuple[Path, Path]], size: int, train: bool) -> None:
        self.pairs = pairs
        self.transform = make_transform(size, train)

    def __len__(self) -> int:
        return len(self.pairs)

    def __getitem__(self, i: int) -> tuple[torch.Tensor, torch.Tensor]:
        return to_tensors(*read_pair(*self.pairs[i]), self.transform)


class SyntheticDataset(Dataset):
    """Each item pastes a random foreground (from a set with masks) onto a random background."""

    def __init__(self, fg_pairs: list[tuple[Path, Path]], backgrounds: list[Path], size: int, length: int) -> None:
        if not fg_pairs or not backgrounds:
            raise ValueError("synthetic data needs foregrounds and backgrounds")
        self.fg_pairs, self.backgrounds, self.size, self.length = fg_pairs, backgrounds, size, length
        self.post = v2.Compose([v2.RandomHorizontalFlip(), v2.ToDtype({tv_tensors.Image: torch.float32, "others": None}, scale=True)])

    def __len__(self) -> int:
        return self.length

    def __getitem__(self, i: int) -> tuple[torch.Tensor, torch.Tensor]:
        # torch reseeds each worker every epoch, so this gives fresh composites per epoch.
        rng = np.random.default_rng((torch.initial_seed() + i) % 2**32)
        for _ in range(5):  # a few masks are nearly empty after resizing; draw another
            fg, alpha = read_pair(*self.fg_pairs[rng.integers(len(self.fg_pairs))])
            bg = np.asarray(Image.open(self.backgrounds[rng.integers(len(self.backgrounds))]).convert("RGB"))
            try:
                img, mask = composite(fg, alpha, bg, self.size, rng)
                return to_tensors(img, mask, self.post)
            except ValueError:
                continue
        raise RuntimeError("could not build a synthetic example after 5 tries")
