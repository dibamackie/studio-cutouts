"""Export a checkpoint to ONNX (fp32 + fp16) and check both against PyTorch before trusting them.

    python -m studio_train.export --ckpt D:/studio-ml/runs/first/best.pt --out ../public/models

The exported graph takes `image`: float32 (1, 3, H, W) RGB in [0, 1] with H, W multiples of 32,
and returns `mask`: float32 (1, 1, H, W) alpha in [0, 1]. Normalization and sigmoid are inside.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch
from onnxconverter_common import float16

from .model import Probabilities, build_model, count_params

OPSET = 17
TOLERANCE = {"fp32": 1e-4, "fp16": 2e-2}  # max abs difference in alpha vs PyTorch
CHECK_SIZES = (320, 512)


def load_checkpoint(path: Path) -> Probabilities:
    model = build_model(pretrained=False)
    model.load_state_dict(torch.load(path, map_location="cpu", weights_only=True)["model"])
    return Probabilities(model).eval()


def export_onnx(module: torch.nn.Module, path: Path, size: int = 320) -> None:
    torch.onnx.export(
        module,
        (torch.rand(1, 3, size, size),),
        str(path),
        input_names=["image"],
        output_names=["mask"],
        dynamic_axes={"image": {2: "height", 3: "width"}, "mask": {2: "height", 3: "width"}},
        opset_version=OPSET,
        dynamo=False,  # the TorchScript exporter gives a plain graph that ORT Web handles well
    )
    onnx.checker.check_model(str(path))


# The squeeze-and-excitation blocks average a whole feature map (256×256 values at 512 px input).
# ONNX Runtime's WebGPU backend sums that in fp16, which overflows past 65,504 and wrecks the mask
# on some images; the CPU sums in fp32, so CPU-based parity checks never caught it.
FP32_OPS = ["ReduceMean"]


def to_fp16(src: Path, dst: Path) -> None:
    model = float16.convert_float_to_float16(
        onnx.load(str(src)),
        keep_io_types=True,  # I/O stays float32 for JS
        op_block_list=FP32_OPS,
    )
    onnx.save(model, str(dst))


def max_abs_diff(module: torch.nn.Module, onnx_path: Path) -> float:
    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    worst = 0.0
    gen = torch.Generator().manual_seed(0)
    for size in CHECK_SIZES:
        x = torch.rand(1, 3, size, size, generator=gen)
        with torch.no_grad():
            expected = module(x).numpy()
        got = session.run(["mask"], {"image": x.numpy()})[0]
        worst = max(worst, float(np.abs(expected - got).max()))
    return worst


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ckpt", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--name", default="studio-cutout")
    args = ap.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    module = load_checkpoint(args.ckpt)
    fp32, fp16 = args.out / f"{args.name}.fp32.onnx", args.out / f"{args.name}.fp16.onnx"
    export_onnx(module, fp32)
    to_fp16(fp32, fp16)

    card = {"name": args.name, "params": count_params(module), "opset": OPSET, "input": "image", "output": "mask", "files": {}}
    for kind, path in (("fp32", fp32), ("fp16", fp16)):
        diff = max_abs_diff(module, path)
        ok = diff <= TOLERANCE[kind]
        print(f"{path.name}: {path.stat().st_size / 1e6:.1f} MB, max |onnx - torch| = {diff:.2e} {'OK' if ok else 'FAIL'}")
        if not ok:
            raise SystemExit(f"{kind} export differs from PyTorch by {diff:.2e} (> {TOLERANCE[kind]})")
        card["files"][kind] = {
            "file": path.name,
            "bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "max_abs_diff_vs_torch": diff,
        }
    card["val"] = torch.load(args.ckpt, map_location="cpu", weights_only=True).get("val")
    (args.out / f"{args.name}.json").write_text(json.dumps(card, indent=2))
    print(f"wrote {args.out / f'{args.name}.json'}")


if __name__ == "__main__":
    main()
