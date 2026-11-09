"""Standard salient-object-detection metrics: MAE, IoU@0.5 and max F-measure (beta² = 0.3)."""

from __future__ import annotations

import torch

BETA2 = 0.3  # weights precision over recall, the convention in salient object detection papers
BINS = 256


class SODMetrics:
    """Accumulate per-image metrics over batches; predictions and targets are (N, H, W) in [0, 1]."""

    def __init__(self) -> None:
        self.mae_sum = 0.0
        self.iou_sum = 0.0
        self.precision_sum = torch.zeros(BINS, dtype=torch.float64)
        self.recall_sum = torch.zeros(BINS, dtype=torch.float64)
        self.count = 0

    @torch.no_grad()
    def update(self, pred: torch.Tensor, target: torch.Tensor) -> None:
        if pred.shape != target.shape or pred.dim() != 3:
            raise ValueError(f"expected matching (N, H, W) tensors, got {tuple(pred.shape)} and {tuple(target.shape)}")
        pred = pred.float().clamp(0, 1)
        gt = target > 0.5

        self.mae_sum += (pred - target.float()).abs().mean(dim=(1, 2)).sum().item()

        hard = pred > 0.5
        inter = (hard & gt).sum(dim=(1, 2)).double()
        union = (hard | gt).sum(dim=(1, 2)).double()
        self.iou_sum += torch.where(union > 0, inter / union.clamp(min=1), torch.ones_like(union)).sum().item()

        # Per-image precision/recall at 256 thresholds via histograms (as in PySODMetrics).
        levels = (pred * (BINS - 1)).round().long()
        for lv, g in zip(levels, gt):
            fg_hist = torch.bincount(lv[g], minlength=BINS).flip(0).cumsum(0).flip(0).double()
            bg_hist = torch.bincount(lv[~g], minlength=BINS).flip(0).cumsum(0).flip(0).double()
            tp, fp = fg_hist.cpu(), bg_hist.cpu()
            n_fg = g.sum().item()
            self.precision_sum += tp / (tp + fp).clamp(min=1)
            self.recall_sum += tp / max(n_fg, 1)
        self.count += pred.shape[0]

    def compute(self) -> dict[str, float]:
        if self.count == 0:
            raise ValueError("no samples")
        p = self.precision_sum / self.count
        r = self.recall_sum / self.count
        f = (1 + BETA2) * p * r / (BETA2 * p + r).clamp(min=1e-12)
        return {"mae": self.mae_sum / self.count, "iou": self.iou_sum / self.count, "max_f": f.max().item()}
