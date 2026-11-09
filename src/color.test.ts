import { describe, expect, test } from 'vitest';
import { applyGains, channelGains, MAX_GAIN, objectMean, parseHex, shade } from './color';

test('objectMean averages only the opaque pixels', () => {
  const rgba = new Uint8ClampedArray([100, 50, 0, 255, 200, 150, 100, 255, 255, 255, 255, 0]);
  expect(objectMean(rgba)).toEqual([150, 100, 50]);
  expect(objectMean(new Uint8ClampedArray([1, 2, 3, 0]))).toBeNull();
});

describe('channelGains', () => {
  test('pulls a brighter frame down and a darker one up toward the median', () => {
    const gains = channelGains([
      [100, 100, 100],
      [110, 110, 110], // the median frame
      [120, 120, 120],
    ]);
    expect(gains[1]).toEqual([1, 1, 1]);
    expect(gains[0][0]).toBeCloseTo(1.1);
    expect(gains[2][0]).toBeCloseTo(110 / 120);
  });

  test('caps the correction so a genuinely different view is not repainted', () => {
    const gains = channelGains([[40, 40, 40], [200, 200, 200], [200, 200, 200]]);
    expect(gains[0][0]).toBe(MAX_GAIN);
  });

  test('handles a single frame and a black channel', () => {
    expect(channelGains([[0, 10, 20]])).toEqual([[1, 1, 1]]);
    expect(channelGains([])).toEqual([]);
  });
});

test('applyGains scales RGB, clamps at 255 and leaves alpha alone', () => {
  const rgba = new Uint8ClampedArray([100, 200, 50, 7]);
  applyGains(rgba, [1.1, 1.5, 0.5]);
  expect([...rgba]).toEqual([110, 255, 25, 7]);
});

test('parseHex and shade', () => {
  expect(parseHex('#1e90ff')).toEqual([30, 144, 255]);
  expect(() => parseHex('red')).toThrow(/rrggbb/);
  expect(shade([100, 100, 100], 0.5)).toBe('rgb(178 178 178)');
  expect(shade([100, 100, 100], -0.5)).toBe('rgb(50 50 50)');
});
