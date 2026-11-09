import { describe, expect, test } from 'vitest';
import { pickSharpest, sharpness, toGray } from './sharpness';

function checkerboard(size: number, cell: number): Float32Array {
  const g = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) g[y * size + x] = ((x / cell) ^ (y / cell)) & 1 ? 255 : 0;
  return g;
}

function boxBlur(src: Float32Array, size: number): Float32Array {
  const out = new Float32Array(src.length);
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += src[(y + dy) * size + x + dx];
      out[y * size + x] = s / 9;
    }
  }
  return out;
}

describe('sharpness', () => {
  test('a blurred image scores lower than the sharp original', () => {
    const sharp = checkerboard(32, 4);
    expect(sharpness(boxBlur(sharp, 32), 32, 32)).toBeLessThan(sharpness(sharp, 32, 32));
  });

  test('a flat image scores zero', () => {
    expect(sharpness(new Float32Array(16).fill(90), 4, 4)).toBe(0);
  });

  test('rejects mismatched dimensions', () => {
    expect(() => sharpness(new Float32Array(10), 4, 4)).toThrow(/expected 16/);
  });
});

test('toGray uses luma weights', () => {
  expect([...toGray(new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]))].map(Math.round)).toEqual([76, 29]);
});

describe('pickSharpest', () => {
  test('keeps the sharpest frame from each run of candidates', () => {
    expect(pickSharpest([1, 5, 2, 9, 3, 4], 3)).toEqual([1, 3, 5]);
  });

  test('keeps everything when there are fewer candidates than slots', () => {
    expect(pickSharpest([3, 1], 5)).toEqual([0, 1]);
    expect(pickSharpest([3, 1], 0)).toEqual([]);
  });
});
