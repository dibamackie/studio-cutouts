"""Score a cutout model on a prepared test set, at each image's own resolution.

    python -m studio_train.evaluate --model ../public/models/studio-cutout.fp16.onnx --set PREPARED/duts-te --size 384
    python -m studio_train.evaluate --model ../public/models/u2netp.onnx --preset u2netp --set PREPARED/duts-te
    python -m studio_train.evaluate --model ZhengPeng7/BiRefNet_lite --preset birefnet --set PREPARED/dis-te

Presets describe each model's input/output contract:
  studio    ONNX. RGB/255 in, alpha out (normalization and sigmoid inside the graph)
  u2netp    ONNX, rembg's contract: scale by image max, ImageNet-normalize, min-max stretch the first output
  birefnet  PyTorch from Hugging Face (pinned revision; needs transformers, kornia, einops and a CUDA GPU):
            1024 px, ImageNet-normalize, sigmoid on the last output, fp16

ONNX presets use CUDA when the installed onnxruntime has it (onnxruntime-gpu), else the CPU.
The onnx-community ONNX export of BiRefNet ran ~1 image/minute on CUDA (deform_conv2d has no native
ONNX op), so BiRefNet is scored with its original PyTorch code instead.
"""

from __future__ import annotations

import argparse
import json
import random
import time
from pathlib import Path
from typing import Any, Callable

import numpy as np
import onnxruntime as ort
import torch
from PIL import Image

from .data import load_pairs, read_pair
from .metrics import SODMetrics
from .model import IMAGENET_MEAN, IMAGENET_STD

BIREFNET_REVISION = "aa62cd87eafb9cc43056d08ef3615a14628b831d"  # code reviewed on 2026-11-09: model code only, no I/O


def _load_onnx(model: str) -> tuple[ort.InferenceSession, float, str]:
    if "CUDAExecutionProvider" in ort.get_available_providers() and hasattr(ort, "preload_dlls"):
        ort.preload_dlls()  # onnxruntime-gpu: load the CUDA/cuDNN libraries pip installed alongside it
    providers = [p for p in ("CUDAExecutionProvider", "CPUExecutionProvider") if p in ort.get_available_providers()]
    session = ort.InferenceSession(model, providers=providers)
    device = "cuda" if session.get_providers()[0] == "CUDAExecutionProvider" else "cpu"
    return session, Path(model).stat().st_size / 1e6, device


def _load_birefnet(model: str) -> tuple[torch.nn.Module, float, str]:
    from transformers import AutoModelForImageSegmentation  # optional dependency, only for this preset

    if not torch.cuda.is_available():
        raise SystemExit("the birefnet preset needs a CUDA GPU")
    net = AutoModelForImageSegmentation.from_pretrained(model, trust_remote_code=True, revision=BIREFNET_REVISION)
    fp32_mb = sum(p.numel() for p in net.parameters()) * 4 / 1e6  # what a browser would download in fp32
    return net.cuda().half().eval(), fp32_mb, "cuda"


def _studio(session: ort.InferenceSession, img: np.ndarray, size: int) -> np.ndarray:
    x = np.asarray(Image.fromarray(img).resize((size, size), Image.BILINEAR), np.float32) / 255
    return session.run(None, {session.get_inputs()[0].name: x.transpose(2, 0, 1)[None]})[0][0, 0]


def _u2netp(session: ort.InferenceSession, img: np.ndarray, size: int) -> np.ndarray:
    x = np.asarray(Image.fromarray(img).resize((size, size), Image.LANCZOS), np.float32)
    x = (x / max(x.max(), 1) - IMAGENET_MEAN) / IMAGENET_STD
    pred = session.run(None, {session.get_inputs()[0].name: x.transpose(2, 0, 1)[None].astype(np.float32)})[0][0, 0]
    lo, hi = pred.min(), pred.max()
    return (pred - lo) / (hi - lo) if hi > lo else np.zeros_like(pred)


@torch.no_grad()
def _birefnet(net: torch.nn.Module, img: np.ndarray, size: int) -> np.ndarray:
    x = np.asarray(Image.fromarray(img).resize((size, size), Image.BILINEAR), np.float32) / 255
    x = (x - IMAGENET_MEAN) / IMAGENET_STD
    t = torch.from_numpy(x.transpose(2, 0, 1)[None].astype(np.float32)).cuda().half()
    return net(t)[-1].sigmoid()[0, 0].float().cpu().numpy()  # the last output is the final map


Preset = tuple[Callable[[str], tuple[Any, float, str]], Callable[[Any, np.ndarray, int], np.ndarray], int]
PRESETS: dict[str, Preset] = {
    "studio": (_load_onnx, _studio, 384),
    "u2netp": (_load_onnx, _u2netp, 320),
    "birefnet": (_load_birefnet, _birefnet, 1024),
}


def image_scores(pred: np.ndarray, gt: np.ndarray) -> dict[str, float]:
    """IoU at 0.5 and MAE for one image (both arrays in [0, 1], same shape)."""
    p, g = pred >= 0.5, gt >= 0.5
    union = np.logical_or(p, g).sum()
    iou = float(np.logical_and(p, g).sum() / union) if union else 1.0
    return {"iou": round(iou, 4), "mae": round(float(np.abs(pred - gt).mean()), 4)}


def evaluate(model: str, set_dir: Path, preset: str, size: int | None, limit: int | None, per_image: Path | None = None) -> dict:
    load, run, default_size = PRESETS[preset]
    size = size or default_size
    runner, megabytes, device = load(model)
    pairs = load_pairs(set_dir)
    if limit and len(pairs) > limit:
        pairs = random.Random(0).sample(pairs, limit)  # same fixed subset as training validation

    metrics, seconds, rows = SODMetrics(), 0.0, []
    for image, mask in pairs:
        img, gt = read_pair(image, mask)
        t0 = time.perf_counter()
        pred = run(runner, img, size)
        seconds += time.perf_counter() - t0
        full = np.asarray(Image.fromarray(pred.astype(np.float32)).resize((gt.shape[1], gt.shape[0]), Image.BILINEAR))
        metrics.update(torch.from_numpy(full)[None], torch.from_numpy(gt)[None])
        if per_image:
            rows.append({"image": image.name, **image_scores(full, gt)})
    if per_image:
        per_image.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    return {
        "model": Path(model).name,
        "set": set_dir.name,
        "images": len(pairs),
        "input_size": size,
        "mb": round(megabytes, 1),
        **{k: round(v, 4) for k, v in metrics.compute().items()},
        "ms_per_image": round(seconds / len(pairs) * 1000, 1),
        "device": device,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", required=True, help="ONNX file path, or a Hugging Face repo id for --preset birefnet")
    ap.add_argument("--set", type=Path, required=True)
    ap.add_argument("--preset", choices=PRESETS, default="studio")
    ap.add_argument("--size", type=int)
    ap.add_argument("--limit", type=int, help="fixed random subset, matching training's --max-val")
    ap.add_argument("--per-image", type=Path, help="also write each image's IoU and MAE to this JSON-lines file")
    args = ap.parse_args()
    print(json.dumps(evaluate(args.model, args.set, args.preset, args.size, args.limit, args.per_image)))


if __name__ == "__main__":
    main()
