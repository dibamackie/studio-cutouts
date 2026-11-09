import pytest

from studio_train.report import build


def _rec(model, size, set_, f):
    return {"model": model, "input_size": size, "set": set_, "mb": 9.1, "images": 10, "max_f": f, "iou": f - 0.1, "mae": 1 - f}


def test_builds_rows_in_display_order_and_skips_incomplete_models():
    records = [
        _rec("studio-cutout.fp16.onnx", 512, "dis-te", 0.77),
        _rec("studio-cutout.fp16.onnx", 512, "duts-te", 0.87),
        _rec("u2netp.onnx", 320, "dis-te", 0.63),
        _rec("u2netp.onnx", 320, "duts-te", 0.86),
        _rec("BiRefNet_lite", 1024, "dis-te", 0.85),  # no duts-te yet: skipped, not half-shown
    ]
    out = build(records)
    assert [(r["label"], r["inputSize"]) for r in out["quality"]] == [("U²-Netp", 320), ("Studio v1", 512)]
    studio = out["quality"][1]
    assert studio["mine"] is True and studio["browser"] is True
    assert studio["scores"]["dis-te"] == {"max_f": 0.77, "iou": pytest.approx(0.67), "mae": pytest.approx(0.23)}


def test_fails_when_nothing_is_complete():
    with pytest.raises(SystemExit):
        build([_rec("u2netp.onnx", 320, "dis-te", 0.6)])


def test_birefnet_note_only_appears_with_its_row():
    base = [_rec("u2netp.onnx", 320, s, 0.8) for s in ("dis-te", "duts-te")]
    assert "BiRefNet" not in build(base)["notes"]
    with_ref = base + [_rec("BiRefNet_lite", 1024, s, 0.9) for s in ("dis-te", "duts-te")]
    assert "BiRefNet" in build(with_ref)["notes"]
