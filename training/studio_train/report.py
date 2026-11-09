"""Turn evaluate.py output (JSON lines) into the benchmark page's data file.

    python -m studio_train.report --results D:/studio-ml/runs/bench-full.jsonl --out ../src/bench-results.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

SETS = ("dis-te", "duts-te")
# Display rows, keyed by (onnx file name, input size), in table order.
ROWS = [
    {"key": ("birefnet_lite.onnx", 1024), "label": "BiRefNet_lite", "browser": False},
    {"key": ("u2netp.onnx", 320), "label": "U²-Netp", "browser": True},
    {"key": ("studio-cutout.fp16.onnx", 384), "label": "Studio v1", "browser": True, "mine": True},
    {"key": ("studio-cutout.fp16.onnx", 512), "label": "Studio v1", "browser": True, "mine": True},
]
NOTES = (
    "Studio v1 runs at 512 px on WebGPU and 384 px on the CPU fallback. "
    "BiRefNet_lite is the large reference: 44M parameters at 1024 px, scored on a desktop GPU; "
    "its ONNX export is too big to download and run comfortably in a browser. "
    "U²-Netp and BiRefNet were trained on DUTS-TR and DIS-TR respectively, so each has a home set here."
)


def build(records: list[dict]) -> dict:
    by_key: dict[tuple, dict] = {}
    for r in records:
        by_key.setdefault((r["model"], r["input_size"]), {})[r["set"]] = r
    rows = []
    for spec in ROWS:
        found = by_key.get(spec["key"], {})
        if not all(s in found for s in SETS):
            print(f"skipping {spec['label']} @{spec['key'][1]}: missing {[s for s in SETS if s not in found]}")
            continue
        any_set = found[SETS[0]]
        rows.append({
            "label": spec["label"],
            "megabytes": any_set["mb"],
            "inputSize": spec["key"][1],
            "browser": spec["browser"],
            **({"mine": True} if spec.get("mine") else {}),
            "scores": {s: {m: found[s][m] for m in ("max_f", "iou", "mae")} for s in SETS},
            "images": {s: found[s]["images"] for s in SETS},
        })
    if not rows:
        raise SystemExit("no complete rows; run evaluate.py on both sets first")
    return {"quality": rows, "notes": NOTES}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--results", type=Path, nargs="+", required=True)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    records = [json.loads(line) for path in args.results for line in path.read_text().splitlines() if line.strip()]
    args.out.write_text(json.dumps(build(records), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
