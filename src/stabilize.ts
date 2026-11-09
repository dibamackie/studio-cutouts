// Pure geometry for steadying a spin: where the object is in each frame and where it goes on the canvas.

/** Object bounds as fractions of the frame (0–1), so they map onto any source resolution. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /**
   * Horizontal median of the object's pixels: the anchor for centring. A mug's handle swinging into
   * view stretches the box sideways, but barely moves the median, which the body dominates.
   */
  cx: number;
}

/** Canvas position = source pixel × scale + (dx, dy). */
export interface Placement {
  scale: number;
  dx: number;
  dy: number;
}

export const LAYOUT = {
  objectHeight: 0.62, // object height as a fraction of the canvas
  groundY: 0.82, // where the object's base sits
  maxWidth: 0.86, // the widest frame must fit within this fraction
} as const;

const MIN_MASS = 0.002; // below 0.2% of the mask, treat the frame as "no object found"

function trimIndex(counts: Float64Array, mass: number, fromEnd: boolean): number {
  let sum = 0;
  for (let k = 0; k < counts.length; k++) {
    const i = fromEnd ? counts.length - 1 - k : k;
    sum += counts[i];
    if (sum > mass) return i;
  }
  return fromEnd ? 0 : counts.length - 1;
}

/**
 * Bounds of the mask's opaque pixels, ignoring the outermost `trim` share of them on each side,
 * so a few stray specks don't stretch the box. Returns null when there is no real object.
 */
export function robustBox(alpha: Uint8ClampedArray, size: number, threshold = 128, trim = 0.005): Box | null {
  if (alpha.length !== size * size) throw new Error(`expected ${size * size} alpha values, got ${alpha.length}`);
  const cols = new Float64Array(size);
  const rows = new Float64Array(size);
  let total = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (alpha[y * size + x] >= threshold) {
        cols[x]++;
        rows[y]++;
        total++;
      }
    }
  }
  if (total < MIN_MASS * size * size) return null;
  const cut = total * trim;
  return {
    x0: trimIndex(cols, cut, false) / size,
    x1: (trimIndex(cols, cut, true) + 1) / size,
    y0: trimIndex(rows, cut, false) / size,
    y1: (trimIndex(rows, cut, true) + 1) / size,
    cx: (trimIndex(cols, total / 2, false) + 0.5) / size,
  };
}

const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Median of each edge over neighbouring frames. Wraps around for a full spin, where the last frame meets the first. */
export function smoothBoxes(boxes: readonly Box[], radius: number, circular: boolean): Box[] {
  const n = boxes.length;
  return boxes.map((_, i) => {
    const window: Box[] = [];
    for (let k = -radius; k <= radius; k++) {
      const j = circular ? (((i + k) % n) + n) % n : i + k;
      if (j >= 0 && j < n && (circular ? Math.abs(k) <= (n - 1) / 2 : true)) window.push(boxes[j]);
    }
    return {
      x0: median(window.map((b) => b.x0)),
      y0: median(window.map((b) => b.y0)),
      x1: median(window.map((b) => b.x1)),
      y1: median(window.map((b) => b.y1)),
      cx: median(window.map((b) => b.cx)),
    };
  });
}

/**
 * Scale each frame so the object has the same height (a walking photographer changes distance),
 * then shrink all frames by one shared factor so the widest view still fits. Centre the object's
 * median column, stand the base on the ground line.
 */
export function placeFrames(boxes: readonly Box[], sizes: readonly { w: number; h: number }[], canvas: number): Placement[] {
  if (boxes.length !== sizes.length) throw new Error('boxes and sizes differ in length');
  const heightScale = boxes.map((b, i) => (LAYOUT.objectHeight * canvas) / Math.max(1, (b.y1 - b.y0) * sizes[i].h));
  // Width needed if centred on the anchor: twice the larger reach to either side.
  const span = (b: Box) => 2 * Math.max(b.cx - b.x0, b.x1 - b.cx);
  const fit = Math.min(1, ...boxes.map((b, i) => (LAYOUT.maxWidth * canvas) / Math.max(1, span(b) * sizes[i].w * heightScale[i])));
  return boxes.map((b, i) => {
    const scale = heightScale[i] * fit;
    const centerX = b.cx * sizes[i].w;
    const baseY = b.y1 * sizes[i].h;
    return { scale, dx: canvas / 2 - centerX * scale, dy: LAYOUT.groundY * canvas - baseY * scale };
  });
}
