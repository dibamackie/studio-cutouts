"""Synthetic training examples: paste a cut-out object onto a random background.

Pure numpy/PIL, no torch, so it is unit-testable and deterministic for a given RNG.
"""

from __future__ import annotations

import io
from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageFilter

ALPHA_VISIBLE = 0.05  # alpha above this counts as part of the object when cropping


@dataclass(frozen=True)
class CompositeOptions:
    object_scale: tuple[float, float] = (0.35, 0.9)  # object's long side as a fraction of the canvas
    shadow_prob: float = 0.5
    bg_blur_prob: float = 0.3  # product shots often have a shallow depth of field
    brightness: tuple[float, float] = (0.8, 1.2)  # applied to the object only, so it may not match the scene
    degrade: bool = True  # global blur + JPEG artifacts


def _bbox(alpha: np.ndarray) -> tuple[int, int, int, int]:
    ys, xs = np.nonzero(alpha > ALPHA_VISIBLE)
    if ys.size == 0:
        raise ValueError("alpha mask is empty")
    return ys.min(), ys.max() + 1, xs.min(), xs.max() + 1


def _cover_crop(bg: np.ndarray, size: int, rng: np.random.Generator) -> np.ndarray:
    """Scale the background to cover a size×size canvas, then take a random crop."""
    h, w = bg.shape[:2]
    scale = size / min(h, w) * rng.uniform(1.0, 1.5)
    nh, nw = max(size, round(h * scale)), max(size, round(w * scale))
    img = Image.fromarray(bg).resize((nw, nh), Image.BILINEAR)
    y, x = rng.integers(0, nh - size + 1), rng.integers(0, nw - size + 1)
    return np.asarray(img)[y : y + size, x : x + size]


def _shadow(alpha: np.ndarray, rng: np.random.Generator, size: int) -> np.ndarray:
    """Soft drop shadow: the object's alpha, squashed toward its base, shifted and blurred."""
    img = Image.fromarray((alpha * 255).astype(np.uint8))
    dy, dx = int(rng.uniform(0.01, 0.05) * size), int(rng.uniform(-0.04, 0.04) * size)
    shifted = Image.new("L", img.size)
    shifted.paste(img, (dx, dy))
    blurred = shifted.filter(ImageFilter.GaussianBlur(rng.uniform(0.01, 0.04) * size))
    return np.asarray(blurred, dtype=np.float32) / 255


def composite(
    fg: np.ndarray,
    alpha: np.ndarray,
    bg: np.ndarray,
    size: int,
    rng: np.random.Generator,
    opts: CompositeOptions = CompositeOptions(),
) -> tuple[np.ndarray, np.ndarray]:
    """Return (image uint8 size×size×3, mask float32 size×size in [0, 1])."""
    if fg.shape[:2] != alpha.shape:
        raise ValueError(f"fg {fg.shape[:2]} and alpha {alpha.shape} differ in size")

    y0, y1, x0, x1 = _bbox(alpha)
    obj = fg[y0:y1, x0:x1]
    obj_alpha = alpha[y0:y1, x0:x1]

    long_side = rng.uniform(*opts.object_scale) * size
    scale = long_side / max(obj.shape[:2])
    oh, ow = max(1, round(obj.shape[0] * scale)), max(1, round(obj.shape[1] * scale))
    obj = np.asarray(Image.fromarray(obj).resize((ow, oh), Image.BILINEAR), dtype=np.float32)
    obj_alpha = np.asarray(
        Image.fromarray((obj_alpha * 255).astype(np.uint8)).resize((ow, oh), Image.BILINEAR), dtype=np.float32
    ) / 255
    obj = np.clip(obj * rng.uniform(*opts.brightness), 0, 255)

    oy = int(rng.integers(0, size - oh + 1))
    ox = int(rng.integers(0, size - ow + 1))
    mask = np.zeros((size, size), np.float32)
    mask[oy : oy + oh, ox : ox + ow] = obj_alpha
    layer = np.zeros((size, size, 3), np.float32)
    layer[oy : oy + oh, ox : ox + ow] = obj

    background = _cover_crop(bg, size, rng)
    if rng.random() < opts.bg_blur_prob:
        background = np.asarray(Image.fromarray(background).filter(ImageFilter.GaussianBlur(rng.uniform(1, 6))))
    background = background.astype(np.float32)
    if rng.random() < opts.shadow_prob:
        background *= 1 - rng.uniform(0.2, 0.6) * _shadow(mask, rng, size)[..., None]

    a = mask[..., None]
    out = np.clip(layer * a + background * (1 - a), 0, 255).astype(np.uint8)

    if opts.degrade:
        img = Image.fromarray(out)
        if rng.random() < 0.2:
            img = img.filter(ImageFilter.GaussianBlur(rng.uniform(0.3, 1.2)))
        if rng.random() < 0.5:
            buf = io.BytesIO()
            img.save(buf, "JPEG", quality=int(rng.integers(40, 96)))
            img = Image.open(buf).convert("RGB")
        out = np.asarray(img)
    return out, mask
