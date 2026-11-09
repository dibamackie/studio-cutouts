# Training the Studio cutout model

A small U-Net (MobileNetV3-Large encoder, ImageNet-pretrained, slim decoder) trained for salient-object cutout, exported to ONNX for the browser.

- **Input:** RGB in [0, 1], shape (1, 3, H, W), H and W multiples of 32. ImageNet normalization is inside the graph.
- **Output:** alpha in [0, 1], shape (1, 1, H, W). The sigmoid is inside the graph.
- **Budget:** ≤ 6M parameters; the fp16 ONNX file is what the browser downloads.

## Setup

Python 3.12 and an NVIDIA GPU (developed on an RTX 3070, 8 GB). Keep data and runs outside the repo; the examples use `D:/studio-ml`.

```bash
py -3.12 -m venv D:/studio-ml/venv
D:/studio-ml/venv/Scripts/python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
D:/studio-ml/venv/Scripts/python -m pip install -r requirements.txt
```

Run the unit tests from this folder:

```bash
D:/studio-ml/venv/Scripts/python -m pytest
```

## Data

| Set | Use | Source | License |
|---|---|---|---|
| DUTS-TR (10,553) | train, synthetic foregrounds | [saliencydetection.net/duts](http://saliencydetection.net/duts/) | No explicit license from the authors; treat as research-only |
| DUTS-TE (5,019) | validation | same | same |
| DIS5K DIS-TR (3,000) | train, synthetic foregrounds | [github.com/xuebinqin/DIS](https://github.com/xuebinqin/DIS) | Research use; commercial use needs separate terms with the authors |
| COCO val2017 (5,000) | backgrounds for synthetic composites | [cocodataset.org](https://cocodataset.org) | Annotations CC BY 4.0; images under various Flickr licenses |

Because of DUTS and DIS5K, models trained with this recipe are for research and demo use. A clean-license variant (Open Images V7 masks, CC BY 4.0, plus my own photos) is planned.

Prepare each set once (resizes to 640 px max side so training doesn't decode 4K images every step):

```bash
python -m studio_train.prepare --images RAW/DUTS-TR/DUTS-TR-Image --masks RAW/DUTS-TR/DUTS-TR-Mask --dst PREPARED/duts-tr
python -m studio_train.prepare --images RAW/DUTS-TE/DUTS-TE-Image --masks RAW/DUTS-TE/DUTS-TE-Mask --dst PREPARED/duts-te
python -m studio_train.prepare --images RAW/DIS5K/DIS-TR/im --masks RAW/DIS5K/DIS-TR/gt --dst PREPARED/dis-tr
python -m studio_train.prepare --images RAW/val2017 --dst PREPARED/coco-bg
```

## Synthetic composites

`studio_train/composite.py` pastes a masked object from the training sets onto a random COCO background: random scale and position, brightness that doesn't match the scene, an optional soft drop shadow, optional background blur (shallow depth of field), then global blur and JPEG artifacts. Every epoch draws fresh composites.

## Train, then export

```bash
python -m studio_train.train --data PREPARED --train duts-tr dis-tr --val duts-te --synthetic 6000 --epochs 30 --out RUNS/first
python -m studio_train.export --ckpt RUNS/first/best.pt --out ../public/models
```

`export.py` writes fp32 and fp16 ONNX files plus a JSON model card, and fails if either file's output differs from PyTorch by more than the tolerance (1e-4 for fp32, 2e-2 for fp16) at 320 and 512 px.

Score any ONNX model, including the U²-Netp baseline, at each test image's own resolution:

```bash
python -m studio_train.evaluate --model RUNS/first/onnx/studio-cutout.fp16.onnx --set PREPARED/dis-vd
python -m studio_train.evaluate --model ../public/models/u2netp.onnx --preset u2netp --set PREPARED/dis-vd
```

## Results: first model (`runs/first`)

Trained on DUTS-TR + DIS-TR + 6,000 fresh synthetic composites per epoch, 384 px, batch 16, 30 epochs, AdamW (lr 1e-3, cosine), on an RTX 3070: about 95 s per epoch, 55 minutes in total. The best checkpoint is from epoch 29. History: [`results/first-history.jsonl`](results/first-history.jsonl); model card: [`results/first-model-card.json`](results/first-model-card.json).

Scored at full resolution (images prepared to 640 px max side), fp16 ONNX:

| Model | Size | DUTS-TE max F | IoU | MAE | DIS-VD max F | IoU | MAE | CPU ms/img |
|---|---|---|---|---|---|---|---|---|
| U²-Netp @320 (baseline) | 4.6 MB | 0.866 | 0.750 | 0.051 | 0.630 | 0.393 | 0.146 | 195 |
| **Studio v1 @384** | 9.1 MB | **0.866** | **0.761** | **0.048** | **0.759** | **0.606** | **0.094** | **23** |

- **DUTS-TE** is 1,000 fixed random images. They were also the validation set used to pick the best epoch, so this column is slightly optimistic for my model. U²-Netp was trained on DUTS, so this is its home ground.
- **DIS-VD** (470 images with fine detail) was not used for training or model selection, so it's the clean comparison: +0.13 max F and +0.21 IoU over the baseline.
- **CPU ms/img** is ONNX Runtime on a desktop CPU (Python), for relative comparison only.

In the browser (desktop Chrome, ONNX Runtime Web 1.31.1, fp16 model):

| Backend | 320 px | 384 px | 512 px |
|---|---|---|---|
| WebGPU (warm) | — | 13–15 ms | 19 ms |
| WASM, 1 thread | 140 ms | 196 ms | 346 ms |

The first run at each new input size recompiles GPU shaders (120–830 ms), so the app should stick to one size per session.

### Full test sets

All of DIS-TE (2,000 images, none used for training or model selection) and DUTS-TE (5,019), fp16 ONNX, each image scored at its own resolution. Raw output: [`results/bench-full.jsonl`](results/bench-full.jsonl).

| Model | DIS-TE max F | IoU | MAE | DUTS-TE max F | IoU | MAE |
|---|---|---|---|---|---|---|
| U²-Netp @320 | 0.637 | 0.392 | 0.147 | 0.852 | 0.739 | 0.053 |
| Studio v1 @384 | 0.767 | 0.612 | 0.089 | 0.864 | 0.759 | **0.048** |
| **Studio v1 @512** | **0.774** | **0.623** | **0.085** | **0.867** | **0.761** | 0.049 |

The page's data file is generated from this output, so the website never shows numbers that weren't measured:

```bash
python -m studio_train.report --results RUNS/bench-full.jsonl --out ../src/bench-results.json
```
