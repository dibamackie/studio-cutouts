// Pure helpers for choosing video frames: how sharp a frame is, and which candidates to keep.

/** Variance of the 4-neighbour Laplacian of a grayscale image: higher means sharper (less motion blur). */
export function sharpness(gray: Uint8ClampedArray | Float32Array, width: number, height: number): number {
  if (gray.length !== width * height) throw new Error(`expected ${width * height} pixels, got ${gray.length}`);
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const lap = gray[i - 1] + gray[i + 1] + gray[i - width] + gray[i + width] - 4 * gray[i];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** RGBA → luma (BT.601), for sharpness scoring. */
export function toGray(rgba: Uint8ClampedArray): Float32Array {
  const gray = new Float32Array(rgba.length / 4);
  for (let p = 0; p < gray.length; p++) {
    gray[p] = 0.299 * rgba[p * 4] + 0.587 * rgba[p * 4 + 1] + 0.114 * rgba[p * 4 + 2];
  }
  return gray;
}

/**
 * Split the candidates (in time order) into `slots` equal runs and keep the sharpest of each run,
 * so the spin keeps even angular spacing but skips blurry frames.
 */
export function pickSharpest(scores: readonly number[], slots: number): number[] {
  if (slots <= 0) return [];
  if (scores.length <= slots) return scores.map((_, i) => i);
  const picked: number[] = [];
  for (let s = 0; s < slots; s++) {
    const start = Math.floor((s * scores.length) / slots);
    const end = Math.floor(((s + 1) * scores.length) / slots);
    let best = start;
    for (let i = start + 1; i < end; i++) if (scores[i] > scores[best]) best = i;
    picked.push(best);
  }
  return picked;
}
