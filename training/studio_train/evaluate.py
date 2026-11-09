"""Score an ONNX cutout model on a prepared test set, at each image's own resolution.

    python -m studio_train.evaluate --model ../public/models/studio-cutout.fp16.onnx --set PREPARED/duts-te --size 384
    python -m studio_train.evaluate --model ../public/models/u2netp.onnx --preset u2netp --set PREPARED/duts-te

Presets describe each model's input/output contract:
  studio  RGB/255 in, alpha out (normalization and sigmoid inside the graph)
  u2netp  rembg's contract: scale by image max, ImageNet-normalize, min-max stretch the first output
"""

from __future__ import annotations

import argparse
import json
import random
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from PIL import Image

from .data import load_pairs, read_pair
from .metrics import SODMetrics
from .model import IMAGENET_MEAN, IMAGENET_STD


def _studio(session: ort.InferenceSession, img: np.ndarray, size: int) -> np.ndarray:
    x = np.asarray(Image.fromarray(img).resize((size, size), Image.BILINEAR), np.float32) / 255
    return session.run(None, {session.get_inputs()[0].name: x.transpose(2, 0, 1)[None]})[0][0, 0]


def _u2netp(session: ort.InferenceSession, img: np.ndarray, size: int) -> np.ndarray:
    x = np.asarray(Image.fromarray(img).resize((size, size), Image.LANCZOS), np.float32)
    x = (x / max(x.max(), 1) - IMAGENET_MEAN) / IMAGENET_STD
    pred = session.run(None, {session.get_inputs()[0].name: x.transpose(2, 0, 1)[None].astype(np.float32)})[0][0, 0]
    lo, hi = pred.min(), pred.max()
    return (pred - lo) / (hi - lo) if hi > lo else np.zeros_like(pred)


PRESETS = {"studio": (_studio, 384), "u2netp": (_u2netp, 320)}


def evaluate(model: Path, set_dir: Path, preset: str, size: int | None, limit: int | None) -> dict:
    run, default_size = PRESETS[preset]
    size = size or default_size
    providers = [p for p in ("CUDAExecutionProvider", "CPUExecutionProvider") if p in ort.get_available_providers()]
    session = ort.InferenceSession(str(model), providers=providers)
    pairs = load_pairs(set_dir)
    if limit and len(pairs) > limit:
        pairs = random.Random(0).sample(pairs, limit)  # same fixed subset as training validation

    metrics, seconds = SODMetrics(), 0.0
    for image, mask in pairs:
        img, gt = read_pair(image, mask)
        t0 = time.perf_counter()
        pred = run(session, img, size)
        seconds += time.perf_counter() - t0
        full = Image.fromarray(pred.astype(np.float32)).resize((gt.shape[1], gt.shape[0]), Image.BILINEAR)
        metrics.update(torch.from_numpy(np.asarray(full))[None], torch.from_numpy(gt)[None])
    return {
        "model": model.name,
        "set": set_dir.name,
        "images": len(pairs),
        "input_size": size,
        "mb": round(model.stat().st_size / 1e6, 1),
        **{k: round(v, 4) for k, v in metrics.compute().items()},
        "ms_per_image_cpu": round(seconds / len(pairs) * 1000, 1),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", type=Path, required=True)
    ap.add_argument("--set", type=Path, required=True)
    ap.add_argument("--preset", choices=PRESETS, default="studio")
    ap.add_argument("--size", type=int)
    ap.add_argument("--limit", type=int, help="fixed random subset, matching training's --max-val")
    args = ap.parse_args()
    print(json.dumps(evaluate(args.model, args.set, args.preset, args.size, args.limit)))


if __name__ == "__main__":
    main()
