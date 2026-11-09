import pytest
import torch

from studio_train.metrics import SODMetrics


def _gt():
    gt = torch.zeros(2, 8, 8)
    gt[:, 2:6, 2:6] = 1
    return gt


def test_perfect_prediction():
    m = SODMetrics()
    m.update(_gt(), _gt())
    assert m.compute() == pytest.approx({"mae": 0.0, "iou": 1.0, "max_f": 1.0})


def test_inverted_prediction():
    m = SODMetrics()
    m.update(1 - _gt(), _gt())
    r = m.compute()
    assert r["mae"] == pytest.approx(1.0)
    assert r["iou"] == pytest.approx(0.0)


def test_soft_prediction_is_thresholded_for_iou_but_not_mae():
    gt = _gt()
    pred = gt * 0.8  # confident but not saturated
    m = SODMetrics()
    m.update(pred, gt)
    r = m.compute()
    assert r["iou"] == pytest.approx(1.0)
    assert r["mae"] == pytest.approx(0.2 * 16 / 64)
    assert r["max_f"] == pytest.approx(1.0)  # some threshold separates it perfectly


def test_half_overlap_iou():
    gt = torch.zeros(1, 4, 4)
    gt[0, :, :2] = 1
    pred = torch.zeros(1, 4, 4)
    pred[0, :, 1:3] = 1
    m = SODMetrics()
    m.update(pred, gt)
    assert m.compute()["iou"] == pytest.approx(4 / 12)


def test_accumulates_across_batches():
    m = SODMetrics()
    m.update(_gt()[:1], _gt()[:1])
    m.update(1 - _gt()[:1], _gt()[:1])
    assert m.compute()["iou"] == pytest.approx(0.5)


def test_rejects_bad_shapes_and_empty():
    m = SODMetrics()
    with pytest.raises(ValueError):
        m.update(torch.zeros(1, 4, 4), torch.zeros(1, 4, 5))
    with pytest.raises(ValueError, match="no samples"):
        m.compute()
