"""Failure gallery: each test image beside its cutout on a checkerboard, one row per image.

    python -m studio_train.gallery --model ../public/models/studio-v1.1.fp16.onnx \
        --images D:/studio-ml/samples/hard --out ../docs/failure-gallery.jpg
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .data import list_images
from .evaluate import PRESETS

TILE = (480, 360)
CHECK = 16


def checkerboard(size: tuple[int, int]) -> Image.Image:
    w, h = size
    y, x = np.mgrid[0:h, 0:w]
    board = np.where(((x // CHECK) + (y // CHECK)) % 2 == 0, 236, 205).astype(np.uint8)
    return Image.fromarray(board).convert("RGB")


def label(img: Image.Image, text: str) -> None:
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("segoeui.ttf", 20)
    except OSError:
        font = ImageFont.load_default()
    box = draw.textbbox((12, 10), text, font=font)
    draw.rectangle((box[0] - 6, box[1] - 4, box[2] + 6, box[3] + 4), fill=(20, 20, 20))
    draw.text((12, 10), text, fill=(255, 255, 255), font=font)


def row(image: Image.Image, alpha: np.ndarray, name: str) -> Image.Image:
    original = image.resize(TILE, Image.LANCZOS)
    mask = Image.fromarray((np.clip(alpha, 0, 1) * 255).astype(np.uint8)).resize(TILE, Image.BILINEAR)
    cutout = checkerboard(TILE)
    cutout.paste(original, (0, 0), mask)
    label(original, name)
    out = Image.new("RGB", (TILE[0] * 2 + 8, TILE[1]), (255, 255, 255))
    out.paste(original, (0, 0))
    out.paste(cutout, (TILE[0] + 8, 0))
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", required=True)
    ap.add_argument("--images", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--size", type=int, default=512)
    args = ap.parse_args()

    load, run, _ = PRESETS["studio"]
    session, _, _ = load(args.model)
    rows = []
    for path in list_images(args.images):
        image = Image.open(path).convert("RGB")
        alpha = run(session, np.asarray(image), args.size)
        rows.append(row(image, alpha, path.stem.replace("-", " ")))
    if not rows:
        raise SystemExit(f"no images in {args.images}")
    sheet = Image.new("RGB", (rows[0].width, sum(r.height for r in rows) + 8 * (len(rows) - 1)), (255, 255, 255))
    y = 0
    for r in rows:
        sheet.paste(r, (0, y))
        y += r.height + 8
    args.out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.out, quality=85)
    print(f"wrote {args.out} ({len(rows)} rows)")


if __name__ == "__main__":
    main()
