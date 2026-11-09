import { describe, expect, test } from 'vitest';
import { centerDistance, findLoopEnd } from './loop';

/** Distance from the first view for a turn of `turns` revolutions sampled `n` times: 0 at every full turn. */
function turning(n: number, turns: number, noise = 0): number[] {
  return Array.from({ length: n }, (_, i) => {
    const angle = ((i / n) * turns * 2 * Math.PI) % (2 * Math.PI);
    return 50 * Math.sin(angle / 2) + noise * Math.sin(i * 12.9898);
  });
}

describe('findLoopEnd', () => {
  test('finds where one turn ends when the video shows 1.5 turns', () => {
    const end = findLoopEnd(turning(108, 1.5))!;
    expect(end / 108).toBeCloseTo(2 / 3, 1); // one turn = two thirds of the video
  });

  test('keeps the whole video when it shows exactly one turn', () => {
    expect(findLoopEnd(turning(108, 1))).toBeGreaterThanOrEqual(104);
  });

  test('copes with noise', () => {
    const end = findLoopEnd(turning(108, 1.25, 3))!;
    expect(end / 108).toBeCloseTo(0.8, 1);
  });

  test('returns null when no moment looks like the start (less than a full turn)', () => {
    expect(findLoopEnd(turning(108, 0.6))).toBeNull();
  });

  test('returns null for too few candidates', () => {
    expect(findLoopEnd([0, 1, 2])).toBeNull();
  });
});

describe('centerDistance', () => {
  test('ignores the edges and averages the middle', () => {
    const w = 10;
    const h = 10;
    const a = new Float32Array(w * h);
    const b = new Float32Array(w * h);
    b[0] = 255; // an edge pixel: ignored
    expect(centerDistance(a, b, w, h)).toBe(0);
    b[5 * w + 5] = 36; // a centre pixel; the centre region is 6×6 = 36 pixels
    expect(centerDistance(a, b, w, h)).toBeCloseTo(1);
  });

  test('rejects mismatched frames', () => {
    expect(() => centerDistance(new Float32Array(4), new Float32Array(9), 2, 2)).toThrow();
  });
});
