"""Resize a raw dataset once into the prepared layout, so training doesn't decode 4K images every step.

    python -m studio_train.prepare --images RAW/im --masks RAW/gt --dst PREPARED/dis-tr
    python -m studio_train.prepare --images RAW/val2017 --dst PREPARED/coco-bg        # backgrounds: no masks
"""

from __future__ import annotations

import argparse
from functools import partial
from multiprocessing import Pool
from pathlib import Path

from PIL import Image
from tqdm import tqdm

from .data import list_images


def _fit(img: Image.Image, max_side: int, resample: int) -> Image.Image:
    scale = max_side / max(img.size)
    if scale >= 1:
        return img
    return img.resize((round(img.width * scale), round(img.height * scale)), resample)


def _convert(image: Path, masks: Path | None, dst: Path, max_side: int) -> str | None:
    try:
        img = Image.open(image).convert("RGB")
        if masks is not None:
            mask_path = next((masks / f"{image.stem}{ext}" for ext in (".png", ".jpg", ".bmp") if (masks / f"{image.stem}{ext}").exists()), None)
            if mask_path is None:
                return f"no mask for {image.name}"
            mask = Image.open(mask_path).convert("L")
            if mask.size != img.size:
                return f"size mismatch for {image.name}: image {img.size}, mask {mask.size}"
            _fit(mask, max_side, Image.BILINEAR).save(dst / "masks" / f"{image.stem}.png")
        _fit(img, max_side, Image.LANCZOS).save(dst / "images" / f"{image.stem}.jpg", quality=95)
        return None
    except OSError as err:  # corrupt or unreadable file: report it and keep going
        return f"{image.name}: {err}"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--images", type=Path, required=True)
    ap.add_argument("--masks", type=Path)
    ap.add_argument("--dst", type=Path, required=True)
    ap.add_argument("--max-side", type=int, default=640)
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()

    images = list_images(args.images)
    if not images:
        raise SystemExit(f"no images found in {args.images}")
    (args.dst / "images").mkdir(parents=True, exist_ok=True)
    if args.masks:
        (args.dst / "masks").mkdir(parents=True, exist_ok=True)

    work = partial(_convert, masks=args.masks, dst=args.dst, max_side=args.max_side)
    with Pool(args.workers) as pool:
        problems = [p for p in tqdm(pool.imap_unordered(work, images, chunksize=16), total=len(images)) if p]
    for p in problems[:20]:
        print("skipped:", p)
    print(f"prepared {len(images) - len(problems)}/{len(images)} into {args.dst}")


if __name__ == "__main__":
    main()
