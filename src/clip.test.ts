import { describe, expect, test } from 'vitest';
import { clipSeconds, fillZoom, pushInZoom, spinBlend } from './clip';

describe('spinBlend', () => {
  test('walks through every frame once per turn, crossfading to the next', () => {
    expect(spinBlend(0, 36, 4)).toEqual({ a: 0, b: 1, mix: 0 });
    const mid = spinBlend(2, 36, 4); // halfway round
    expect(mid.a).toBe(18);
    expect(mid.mix).toBeCloseTo(0);
    const between = spinBlend((4 / 36) * 2.5, 36, 4);
    expect(between.a).toBe(2);
    expect(between.mix).toBeCloseTo(0.5);
  });

  test('the last frame fades back into the first, so the loop is seamless', () => {
    const end = spinBlend(4 - 0.05, 36, 4);
    expect(end.a).toBe(35);
    expect(end.b).toBe(0);
    expect(spinBlend(4, 36, 4).a).toBe(0); // the second turn starts over
  });

  test('rejects an empty spin', () => {
    expect(() => spinBlend(0, 0)).toThrow(/no frames/);
  });
});

describe('pushInZoom', () => {
  test('eases from 1 to the target zoom and stays there', () => {
    expect(pushInZoom(0, 5, 1.08)).toBe(1);
    expect(pushInZoom(2.5, 5, 1.08)).toBeCloseTo(1.04);
    expect(pushInZoom(5, 5, 1.08)).toBeCloseTo(1.08);
    expect(pushInZoom(9, 5, 1.08)).toBeCloseTo(1.08);
  });

  test('starts and ends slowly', () => {
    const early = pushInZoom(0.5, 5, 1.08) - pushInZoom(0, 5, 1.08);
    const middle = pushInZoom(2.75, 5, 1.08) - pushInZoom(2.25, 5, 1.08);
    expect(early).toBeLessThan(middle);
  });
});

test('a spin gets two full turns, a single photo a push-in', () => {
  expect(clipSeconds(36)).toBe(8);
  expect(clipSeconds(1)).toBe(5);
});

describe('fillZoom', () => {
  test('enlarges a narrow object to use the tall frame, up to a cap', () => {
    expect(fillZoom([400, 500], 1080)).toBeCloseTo(1.3); // capped
    expect(fillZoom([900], 1080)).toBeCloseTo((0.94 * 1080) / 900);
  });

  test('never shrinks, even when an object is already as wide as the frame', () => {
    expect(fillZoom([1100], 1080)).toBe(1);
    expect(fillZoom([], 1080)).toBe(1.3);
  });
});
