import { describe, expect, test } from 'vitest';
import { LAYOUT, placeFrames, robustBox, smoothBoxes, type Box } from './stabilize';

function maskWithRect(size: number, x0: number, y0: number, x1: number, y1: number): Uint8ClampedArray {
  const a = new Uint8ClampedArray(size * size);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) a[y * size + x] = 255;
  return a;
}

describe('robustBox', () => {
  test('finds the rectangle as fractions of the mask, with its median column as the anchor', () => {
    const box = robustBox(maskWithRect(100, 20, 10, 60, 90), 100)!;
    expect(box).toMatchObject({ x0: 0.2, y0: 0.1, x1: 0.6, y1: 0.9 });
    expect(box.cx).toBeCloseTo(0.4, 1); // within a pixel of the block's middle
  });

  test('ignores a stray speck far from the object', () => {
    const a = maskWithRect(100, 20, 10, 60, 90);
    a[99 * 100 + 99] = 255; // one false-positive pixel in the corner
    expect(robustBox(a, 100)).toMatchObject({ x0: 0.2, y0: 0.1, x1: 0.6, y1: 0.9 });
  });

  test('a thin handle widens the box but barely moves the anchor', () => {
    const body = maskWithRect(100, 30, 20, 60, 80);
    const withHandle = maskWithRect(100, 30, 20, 60, 80);
    for (let y = 40; y < 60; y++) for (let x = 60; x < 75; x++) if (x > 70 || y < 43 || y > 56) withHandle[y * 100 + x] = 255;
    const a = robustBox(body, 100)!;
    const b = robustBox(withHandle, 100)!;
    expect(b.x1 - a.x1).toBeGreaterThan(0.1); // the box grows by the handle's reach
    expect(Math.abs(b.cx - a.cx)).toBeLessThanOrEqual(0.02); // the anchor stays on the body
  });

  test('returns null when nothing (or almost nothing) is opaque', () => {
    expect(robustBox(new Uint8ClampedArray(100 * 100), 100)).toBeNull();
    expect(robustBox(maskWithRect(100, 0, 0, 2, 2), 100)).toBeNull();
  });

  test('rejects a mask of the wrong size', () => {
    expect(() => robustBox(new Uint8ClampedArray(10), 4)).toThrow(/expected 16/);
  });
});

describe('smoothBoxes', () => {
  const box = (y1: number): Box => ({ x0: 0.2, y0: 0.1, x1: 0.6, y1, cx: 0.4 });

  test('removes a one-frame glitch with a median', () => {
    const out = smoothBoxes([box(0.9), box(0.9), box(0.5), box(0.9), box(0.9)], 1, false);
    expect(out.map((b) => b.y1)).toEqual([0.9, 0.9, 0.9, 0.9, 0.9]);
  });

  test('wraps around in a full spin, so the first frame is smoothed with the last', () => {
    const out = smoothBoxes([box(0.5), box(0.9), box(0.9), box(0.9), box(0.9)], 1, true);
    expect(out[0].y1).toBe(0.9);
  });

  test('without wrapping, edge frames use only the neighbours they have', () => {
    const out = smoothBoxes([box(0.5), box(0.9), box(0.9)], 1, false);
    expect(out[0].y1).toBe(0.7); // median of [0.5, 0.9]
  });

  test('a single frame is unchanged', () => {
    expect(smoothBoxes([box(0.8)], 2, true)).toEqual([box(0.8)]);
  });
});

describe('placeFrames', () => {
  test('stands the object on the ground line, anchored at the centre, at the target height', () => {
    const [p] = placeFrames([{ x0: 0.4, y0: 0.2, x1: 0.6, y1: 0.8, cx: 0.5 }], [{ w: 1000, h: 500 }], 1000);
    const top = 0.2 * 500 * p.scale + p.dy;
    const bottom = 0.8 * 500 * p.scale + p.dy;
    const anchor = 0.5 * 1000 * p.scale + p.dx;
    expect(bottom).toBeCloseTo(LAYOUT.groundY * 1000);
    expect(bottom - top).toBeCloseTo(LAYOUT.objectHeight * 1000);
    expect(anchor).toBeCloseTo(500);
  });

  test('equalises height when the photographer walks closer', () => {
    const sizes = [{ w: 1000, h: 1000 }, { w: 1000, h: 1000 }];
    const [far, near] = placeFrames(
      [{ x0: 0.45, y0: 0.4, x1: 0.55, y1: 0.6, cx: 0.5 }, { x0: 0.4, y0: 0.3, x1: 0.6, y1: 0.7, cx: 0.5 }],
      sizes,
      800,
    );
    expect(0.2 * 1000 * far.scale).toBeCloseTo(0.4 * 1000 * near.scale);
  });

  test('shrinks every frame by the same factor so the widest view fits', () => {
    // A shoe: tall-ish from the front, very wide from the side.
    const sizes = [{ w: 1000, h: 1000 }, { w: 1000, h: 1000 }];
    const placements = placeFrames(
      [{ x0: 0.4, y0: 0.4, x1: 0.6, y1: 0.6, cx: 0.5 }, { x0: 0.1, y0: 0.4, x1: 0.9, y1: 0.6, cx: 0.5 }],
      sizes,
      1000,
    );
    expect(0.8 * 1000 * placements[1].scale).toBeCloseTo(LAYOUT.maxWidth * 1000);
    expect(placements[0].scale).toBeCloseTo(placements[1].scale); // same object height in both frames
  });

  test('an off-centre anchor still keeps the far edge inside the canvas', () => {
    // Anchor near the left edge of a wide object: the right side reaches much further.
    const [p] = placeFrames([{ x0: 0.1, y0: 0.4, x1: 0.9, y1: 0.6, cx: 0.2 }], [{ w: 1000, h: 1000 }], 1000);
    const right = 0.9 * 1000 * p.scale + p.dx;
    expect(right).toBeLessThanOrEqual(1000 * (0.5 + LAYOUT.maxWidth / 2) + 1e-6);
  });
});
