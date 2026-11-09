"""Where does the model fail? Group per-image DIS-TE scores by object category and compare with a reference.

    python -m studio_train.failures --mine RUNS/studio-dis-te.jsonl --reference RUNS/birefnet-dis-te.jsonl

DIS5K file names encode the category: "<group id>#<Group>#<category id>#<Category>#<flickr id>.jpg".
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
from statistics import mean

MIN_IMAGES = 8  # categories with fewer test images are too noisy to rank


def category(image_name: str) -> str:
    parts = image_name.split("#")
    if len(parts) < 5:
        raise ValueError(f"not a DIS5K file name: {image_name}")
    return f"{parts[1]} / {parts[3]}"


def load(path: Path) -> dict[str, dict]:
    return {r["image"]: r for r in map(json.loads, path.read_text(encoding="utf-8").splitlines()) if r}


def by_category(mine: dict[str, dict], reference: dict[str, dict]) -> list[dict]:
    """Mean IoU per category for both models, over the images both scored."""
    groups: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for name, row in mine.items():
        if name in reference:
            groups[category(name)].append((row["iou"], reference[name]["iou"]))
    rows = [
        {"category": cat, "images": len(pairs), "mine": mean(p[0] for p in pairs), "reference": mean(p[1] for p in pairs)}
        for cat, pairs in groups.items()
        if len(pairs) >= MIN_IMAGES
    ]
    for r in rows:
        r["gap"] = r["reference"] - r["mine"]
    return sorted(rows, key=lambda r: r["mine"])


def markdown(rows: list[dict], title: str) -> str:
    lines = [f"**{title}**", "", "| Category | Images | Studio v1 IoU | BiRefNet_lite IoU | Gap |", "|---|---|---|---|---|"]
    lines += [f"| {r['category']} | {r['images']} | {r['mine']:.2f} | {r['reference']:.2f} | {r['gap']:+.2f} |" for r in rows]
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mine", type=Path, required=True)
    ap.add_argument("--reference", type=Path, required=True)
    ap.add_argument("--top", type=int, default=8)
    args = ap.parse_args()
    rows = by_category(load(args.mine), load(args.reference))
    print(f"{len(rows)} categories with at least {MIN_IMAGES} images\n")
    print(markdown(rows[: args.top], f"Hardest categories for Studio v1 (lowest IoU)"))
    print()
    print(markdown(sorted(rows, key=lambda r: -r["gap"])[: args.top], "Largest gap to BiRefNet_lite"))
    print()
    print(markdown(rows[-args.top :][::-1], "Easiest categories for Studio v1"))


if __name__ == "__main__":
    main()
