import torch

from studio_train.export import TOLERANCE, export_onnx, max_abs_diff, to_fp16
from studio_train.model import PARAM_BUDGET, Probabilities, build_model, count_params
from studio_train.train import cutout_loss, lr_at


def test_model_fits_the_size_budget():
    assert count_params(build_model(pretrained=False)) <= PARAM_BUDGET


def test_output_matches_input_resolution_and_is_a_probability():
    model = Probabilities(build_model(pretrained=False)).eval()
    with torch.no_grad():
        out = model(torch.rand(1, 3, 96, 128))
    assert out.shape == (1, 1, 96, 128)
    assert 0 <= out.min() and out.max() <= 1


def test_onnx_exports_match_pytorch(tmp_path):
    torch.manual_seed(0)
    model = Probabilities(build_model(pretrained=False)).eval()
    fp32, fp16 = tmp_path / "m.fp32.onnx", tmp_path / "m.fp16.onnx"
    export_onnx(model, fp32)
    to_fp16(fp32, fp16)
    assert max_abs_diff(model, fp32) <= TOLERANCE["fp32"]
    assert max_abs_diff(model, fp16) <= TOLERANCE["fp16"]
    assert fp16.stat().st_size < fp32.stat().st_size * 0.6


def test_loss_is_lower_for_the_right_answer():
    target = torch.zeros(1, 1, 8, 8)
    target[..., 2:6, 2:6] = 1
    right = (target * 2 - 1) * 8  # confident logits in the right direction
    assert cutout_loss(right, target) < cutout_loss(-right, target)


def test_lr_schedule_warms_up_then_decays_to_zero():
    assert lr_at(0, 100, 10, 1.0) == 0.1
    assert lr_at(9, 100, 10, 1.0) == 1.0
    assert lr_at(100, 100, 10, 1.0) == 0.0
