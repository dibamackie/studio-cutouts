import numpy as np
import pytest

from studio_train.composite import CompositeOptions, composite

RED, BLUE = (255, 0, 0), (0, 0, 255)
CLEAN = CompositeOptions(shadow_prob=0, bg_blur_prob=0, brightness=(1, 1), degrade=False)


def _square_object(size=40, box=(10, 30)):
    fg = np.zeros((size, size, 3), np.uint8)
    fg[:] = RED
    alpha = np.zeros((size, size), np.float32)
    alpha[box[0] : box[1], box[0] : box[1]] = 1
    return fg, alpha


def _blue_bg(h=60, w=90):
    bg = np.zeros((h, w, 3), np.uint8)
    bg[:] = BLUE
    return bg


def test_output_shapes_and_range():
    fg, alpha = _square_object()
    img, mask = composite(fg, alpha, _blue_bg(), 64, np.random.default_rng(0))
    assert img.shape == (64, 64, 3) and img.dtype == np.uint8
    assert mask.shape == (64, 64) and mask.dtype == np.float32
    assert 0 <= mask.min() and mask.max() <= 1


def test_object_pixels_match_mask_without_augmentation():
    fg, alpha = _square_object()
    img, mask = composite(fg, alpha, _blue_bg(), 64, np.random.default_rng(1), CLEAN)
    inside, outside = mask == 1, mask == 0
    assert inside.any() and outside.any()
    assert (img[inside] == RED).all()
    assert (img[outside] == BLUE).all()


def test_object_scale_follows_options():
    fg, alpha = _square_object()
    opts = CompositeOptions(object_scale=(0.5, 0.5), shadow_prob=0, bg_blur_prob=0, degrade=False)
    _, mask = composite(fg, alpha, _blue_bg(), 100, np.random.default_rng(2), opts)
    ys, xs = np.nonzero(mask > 0.5)
    assert ys.max() - ys.min() + 1 == pytest.approx(50, abs=1)
    assert xs.max() - xs.min() + 1 == pytest.approx(50, abs=1)


def test_same_seed_is_deterministic():
    fg, alpha = _square_object()
    a = composite(fg, alpha, _blue_bg(), 64, np.random.default_rng(7))
    b = composite(fg, alpha, _blue_bg(), 64, np.random.default_rng(7))
    assert (a[0] == b[0]).all() and (a[1] == b[1]).all()


def test_shadow_only_darkens_the_background():
    fg, alpha = _square_object()
    opts = CompositeOptions(shadow_prob=1, bg_blur_prob=0, brightness=(1, 1), degrade=False)
    img, mask = composite(fg, alpha, _blue_bg(), 64, np.random.default_rng(3), opts)
    bg_pixels = img[mask == 0]
    assert (bg_pixels[:, 2] <= 255).all() and (bg_pixels[:, 2] < 255).any()  # some shadow fell
    assert (bg_pixels[:, :2] == 0).all()  # darkening never adds color


def test_empty_alpha_is_rejected():
    fg, _ = _square_object()
    with pytest.raises(ValueError, match="empty"):
        composite(fg, np.zeros((40, 40), np.float32), _blue_bg(), 64, np.random.default_rng(0))


def test_mismatched_alpha_is_rejected():
    fg, _ = _square_object()
    with pytest.raises(ValueError, match="differ"):
        composite(fg, np.ones((10, 10), np.float32), _blue_bg(), 64, np.random.default_rng(0))
