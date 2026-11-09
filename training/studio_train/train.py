"""Train the cutout model.

    python -m studio_train.train --data D:/studio-ml/data/prepared --train duts-tr dis-tr \
        --val duts-te --synthetic 6000 --epochs 30 --out D:/studio-ml/runs/first
"""

from __future__ import annotations

import argparse
import json
import math
import random
import time
from pathlib import Path

import torch
import torch.nn.functional as F
from torch.utils.data import ConcatDataset, DataLoader, Subset

from .data import PairDataset, SyntheticDataset, list_images, load_pairs
from .metrics import SODMetrics
from .model import build_model, count_params


def soft_iou_loss(logits: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
    p = torch.sigmoid(logits)
    inter = (p * target).sum(dim=(1, 2, 3))
    union = (p + target - p * target).sum(dim=(1, 2, 3))
    return (1 - (inter + 1) / (union + 1)).mean()


def cutout_loss(logits: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
    return F.binary_cross_entropy_with_logits(logits, target) + soft_iou_loss(logits, target)


def build_loaders(args: argparse.Namespace) -> tuple[DataLoader, DataLoader]:
    train_pairs = [pair for name in args.train for pair in load_pairs(args.data / name)]
    parts = [PairDataset(train_pairs, args.size, train=True)]
    if args.synthetic:
        backgrounds = list_images(args.data / args.backgrounds / "images")
        parts.append(SyntheticDataset(train_pairs, backgrounds, args.size, args.synthetic))
    train_ds = ConcatDataset(parts)

    val_pairs = load_pairs(args.data / args.val)
    if args.max_val and len(val_pairs) > args.max_val:
        val_pairs = random.Random(0).sample(val_pairs, args.max_val)  # fixed subset: comparable across runs
    val_ds = PairDataset(val_pairs, args.size, train=False)

    if args.smoke:
        train_ds, val_ds = Subset(train_ds, range(args.batch * 3)), Subset(val_ds, range(args.batch))
    common = dict(num_workers=args.workers, pin_memory=True, persistent_workers=args.workers > 0)
    return (
        DataLoader(train_ds, args.batch, shuffle=True, drop_last=True, **common),
        DataLoader(val_ds, args.batch, shuffle=False, **common),
    )


def lr_at(step: int, total: int, warmup: int, base: float) -> float:
    if step < warmup:
        return base * (step + 1) / warmup
    progress = (step - warmup) / max(1, total - warmup)
    return base * 0.5 * (1 + math.cos(math.pi * progress))


@torch.no_grad()
def evaluate(model: torch.nn.Module, loader: DataLoader, device: torch.device) -> dict[str, float]:
    model.eval()
    metrics = SODMetrics()
    for x, y in loader:
        x = x.to(device, non_blocking=True).to(memory_format=torch.channels_last)
        with torch.autocast(device.type, dtype=torch.bfloat16, enabled=device.type == "cuda"):
            pred = torch.sigmoid(model(x)).float()
        metrics.update(pred[:, 0], y.to(device)[:, 0])
    return metrics.compute()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", type=Path, required=True)
    ap.add_argument("--train", nargs="+", required=True, help="prepared set names with masks")
    ap.add_argument("--val", required=True)
    ap.add_argument("--max-val", type=int, default=1000)
    ap.add_argument("--backgrounds", default="coco-bg")
    ap.add_argument("--synthetic", type=int, default=0, help="synthetic composites per epoch (0 = off)")
    ap.add_argument("--size", type=int, default=384)
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--smoke", action="store_true", help="3 batches per epoch, to test the pipeline")
    args = ap.parse_args()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    torch.manual_seed(0)
    torch.backends.cudnn.benchmark = True
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "config.json").write_text(json.dumps({k: str(v) for k, v in vars(args).items()}, indent=2))

    train_loader, val_loader = build_loaders(args)
    model = build_model(pretrained=True).to(device).to(memory_format=torch.channels_last)
    print(f"params: {count_params(model):,} | train batches/epoch: {len(train_loader)} | device: {device}")

    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    total = args.epochs * len(train_loader)
    warmup = min(500, total // 10)
    step, best = 0, -1.0
    for epoch in range(args.epochs):
        model.train()
        t0, loss_sum = time.time(), 0.0
        for x, y in train_loader:
            for group in optimizer.param_groups:
                group["lr"] = lr_at(step, total, warmup, args.lr)
            x = x.to(device, non_blocking=True).to(memory_format=torch.channels_last)
            y = y.to(device, non_blocking=True)
            with torch.autocast(device.type, dtype=torch.bfloat16, enabled=device.type == "cuda"):
                logits = model(x)
            loss = cutout_loss(logits.float(), y)
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            optimizer.step()
            loss_sum += loss.item()
            step += 1

        val = evaluate(model, val_loader, device)
        record = {"epoch": epoch + 1, "loss": loss_sum / len(train_loader), **val, "seconds": round(time.time() - t0)}
        print(json.dumps(record))
        with open(args.out / "history.jsonl", "a") as f:
            f.write(json.dumps(record) + "\n")
        state = {"model": model.state_dict(), "epoch": epoch + 1, "val": val}
        torch.save(state, args.out / "last.pt")
        if val["max_f"] > best:
            best = val["max_f"]
            torch.save(state, args.out / "best.pt")
    print(f"best val max F: {best:.4f} -> {args.out / 'best.pt'}")


if __name__ == "__main__":
    main()
