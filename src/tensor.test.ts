import { describe, expect, test } from 'vitest';
import { alphaToMaskRgba, IMAGENET_MEAN, IMAGENET_STD, percentile, probToAlpha, toAlpha, toRembgTensor, toUnitTensor } from './tensor';
import { isModelId, MODELS, pickBackend } from './models';

describe('toRembgTensor (U²-Netp contract)', () => {
  test('lays pixels out as NCHW planes and normalizes by image max then ImageNet stats', () => {
    // 2×1 image: a pure red pixel and a half-gray pixel; alpha must be ignored.
    const rgba = new Uint8ClampedArray([255, 0, 0, 7, 128, 128, 128, 255]);
    const t = toRembgTensor(rgba, 2, 1);
    const norm = (v: number, c: number) => (v / 255 - IMAGENET_MEAN[c]) / IMAGENET_STD[c];

    expect(t).toHaveLength(6);
    expect(t[0]).toBeCloseTo(norm(255, 0)); // R plane, pixel 0
    expect(t[1]).toBeCloseTo(norm(128, 0)); // R plane, pixel 1
    expect(t[2]).toBeCloseTo(norm(0, 1)); // G plane, pixel 0
    expect(t[5]).toBeCloseTo(norm(128, 2)); // B plane, pixel 1
  });

  test('handles an all-black image without NaN', () => {
    const t = toRembgTensor(new Uint8ClampedArray([0, 0, 0, 255]), 1, 1);
    expect(t.every(Number.isFinite)).toBe(true);
  });

  test('rejects a buffer that does not match the dimensions', () => {
    expect(() => toRembgTensor(new Uint8ClampedArray(4), 2, 2)).toThrow(/expected 16/);
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

describe('toUnitTensor (Studio contract)', () => {
  test('lays pixels out as NCHW planes scaled to [0, 1], ignoring alpha', () => {
    const t = toUnitTensor(new Uint8ClampedArray([255, 0, 51, 7, 0, 102, 255, 255]), 2, 1);
    expect([...t].map((v) => +v.toFixed(3))).toEqual([1, 0, 0, 0.4, 0.2, 1]);
  });

  test('rejects a buffer that does not match the dimensions', () => {
    expect(() => toUnitTensor(new Uint8ClampedArray(8), 2, 2)).toThrow(/expected 16/);
  });
});

test('probToAlpha scales, rounds and clamps without stretching', () => {
  expect([...probToAlpha(new Float32Array([0, 0.5, 1, 1.2, -0.1]))]).toEqual([0, 128, 255, 255, 0]);
});

describe('percentile', () => {
  test('nearest-rank median and p90', () => {
    const samples = [5, 1, 4, 2, 3, 6, 7, 8, 9, 10];
    expect(percentile(samples, 50)).toBe(5);
    expect(percentile(samples, 90)).toBe(9);
    expect(percentile([42], 90)).toBe(42);
  });

  test('rejects empty input', () => {
    expect(() => percentile([], 50)).toThrow(/no samples/);
  });
});

test('model registry validates ids from the URL', () => {
  expect(isModelId('studio-v1')).toBe(true);
  expect(isModelId('u2netp')).toBe(true);
  expect(isModelId('toString')).toBe(false); // inherited keys don't count
  expect(isModelId(null)).toBe(false);
  for (const spec of Object.values(MODELS)) {
    expect(spec.inputSize.webgpu % 32).toBe(0);
    expect(spec.inputSize.wasm % 32).toBe(0);
  }
});

describe('pickBackend', () => {
  test('keeps WebGPU when it is faster or only slightly slower', () => {
    expect(pickBackend(19, 196)).toBe('webgpu'); // desktop RTX 3070
    expect(pickBackend(110, 100)).toBe('webgpu'); // within the 20% margin: keep the sharper 512 px input
  });

  test('switches to the CPU when it is clearly faster', () => {
    expect(pickBackend(510, 183)).toBe('wasm'); // Android phone, Imagination D-Series GPU
  });

  test('uses the CPU when WebGPU did not start', () => {
    expect(pickBackend(null, 183)).toBe('wasm');
  });
});
