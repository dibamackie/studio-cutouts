import { describe, expect, test } from 'vitest';
import { alphaToMaskRgba, IMAGENET_MEAN, IMAGENET_STD, toAlpha, toInputTensor } from './tensor';

describe('toInputTensor', () => {
  test('lays pixels out as NCHW planes and normalizes by image max then ImageNet stats', () => {
    // 2×1 image: a pure red pixel and a half-gray pixel; alpha must be ignored.
    const rgba = new Uint8ClampedArray([255, 0, 0, 7, 128, 128, 128, 255]);
    const t = toInputTensor(rgba, 2, 1);
    const norm = (v: number, c: number) => (v / 255 - IMAGENET_MEAN[c]) / IMAGENET_STD[c];

    expect(t).toHaveLength(6);
    expect(t[0]).toBeCloseTo(norm(255, 0)); // R plane, pixel 0
    expect(t[1]).toBeCloseTo(norm(128, 0)); // R plane, pixel 1
    expect(t[2]).toBeCloseTo(norm(0, 1)); // G plane, pixel 0
    expect(t[5]).toBeCloseTo(norm(128, 2)); // B plane, pixel 1
  });

  test('handles an all-black image without NaN', () => {
    const t = toInputTensor(new Uint8ClampedArray([0, 0, 0, 255]), 1, 1);
    expect(t.every(Number.isFinite)).toBe(true);
  });

  test('rejects a buffer that does not match the dimensions', () => {
    expect(() => toInputTensor(new Uint8ClampedArray(4), 2, 2)).toThrow(/expected 16/);
  });
});

describe('toAlpha', () => {
  test('stretches the prediction to the full 0–255 range', () => {
    expect([...toAlpha(new Float32Array([0.001, 0.0005, 0.0015]))]).toEqual([128, 0, 255]);
  });

  test('returns a transparent mask for a flat prediction', () => {
    expect([...toAlpha(new Float32Array([0.3, 0.3]))]).toEqual([0, 0]);
  });
});

test('alphaToMaskRgba writes only the alpha channel', () => {
  expect([...alphaToMaskRgba(new Uint8ClampedArray([9, 200]))]).toEqual([0, 0, 0, 9, 0, 0, 0, 200]);
});
