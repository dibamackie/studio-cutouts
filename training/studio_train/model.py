"""Cutout model: a small U-Net whose input is RGB in [0, 1] (normalization is part of the graph)."""

from __future__ import annotations

import segmentation_models_pytorch as smp
import torch
from torch import nn

ENCODER = "tu-mobilenetv3_large_100"  # timm MobileNetV3-Large, ImageNet-pretrained
DECODER_CHANNELS = (128, 64, 32, 16, 8)  # slimmer than smp's default (256..16) to fit the size budget
PARAM_BUDGET = 6_000_000
IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)


class Cutout(nn.Module):
    """Normalizes internally so the browser only feeds raw RGB/255. Returns logits (N, 1, H, W)."""

    def __init__(self, net: nn.Module) -> None:
        super().__init__()
        self.net = net
        self.register_buffer("mean", torch.tensor(IMAGENET_MEAN).view(1, 3, 1, 1))
        self.register_buffer("std", torch.tensor(IMAGENET_STD).view(1, 3, 1, 1))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net((x - self.mean) / self.std)


class Probabilities(nn.Module):
    """Export wrapper: sigmoid on top, so the browser gets alpha in [0, 1] directly."""

    def __init__(self, model: Cutout) -> None:
        super().__init__()
        self.model = model

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return torch.sigmoid(self.model(x))


def build_model(pretrained: bool = True) -> Cutout:
    net = smp.Unet(
        encoder_name=ENCODER,
        encoder_weights="imagenet" if pretrained else None,
        decoder_channels=DECODER_CHANNELS,
        classes=1,
    )
    return Cutout(net)


def count_params(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters())
