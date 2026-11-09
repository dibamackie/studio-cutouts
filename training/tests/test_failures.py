import numpy as np
import pytest

from studio_train.evaluate import image_scores
from studio_train.failures import by_category, category


def test_category_reads_the_dis5k_file_name():
    assert category("11#Furniture#4#Chair#6058764304_34287f447b_o.jpg") == "Furniture / Chair"
    with pytest.raises(ValueError):
        category("ILSVRC2012_test_00000003.jpg")


def test_by_category_averages_shared_images_and_sorts_hardest_first():
    def rows(scores):
        return {f"1#G#{c}#{c}#{i}.jpg": {"iou": s} for c, ss in scores.items() for i, s in enumerate(ss)}

    mine = rows({"Cable": [0.2] * 8, "Mug": [0.9] * 8, "Rare": [0.1] * 3})
    ref = rows({"Cable": [0.8] * 8, "Mug": [0.95] * 8, "Rare": [0.9] * 3})
    out = by_category(mine, ref)
    assert [r["category"] for r in out] == ["G / Cable", "G / Mug"]  # "Rare" has too few images to rank
    assert out[0]["gap"] == pytest.approx(0.6)


def test_image_scores():
    gt = np.zeros((4, 4), np.float32)
    gt[:, :2] = 1
    pred = np.zeros((4, 4), np.float32)
    pred[:, 1:3] = 0.9
    s = image_scores(pred, gt)
    assert s["iou"] == pytest.approx(4 / 12, abs=1e-4)
    assert image_scores(np.zeros((2, 2)), np.zeros((2, 2)))["iou"] == 1.0
