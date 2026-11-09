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
