// Pure pre/post-processing for salient-object models. No DOM, so it is unit-testable.

export const IMAGENET_MEAN = [0.485, 0.456, 0.406] as const;
export const IMAGENET_STD = [0.229, 0.224, 0.225] as const;

function checkSize(rgba: Uint8ClampedArray, width: number, height: number): number {
  const plane = width * height;
  if (rgba.length !== plane * 4) {
    throw new Error(`expected ${plane * 4} RGBA bytes, got ${rgba.length}`);
  }
  return plane;
}

/** RGBA pixels → NCHW float32 RGB in [0, 1]. For models with normalization inside the graph (Studio). */
export function toUnitTensor(rgba: Uint8ClampedArray, width: number, height: number): Float32Array {
  const plane = checkSize(rgba, width, height);
  const out = new Float32Array(plane * 3);
  for (let p = 0; p < plane; p++) {
    for (let c = 0; c < 3; c++) out[c * plane + p] = rgba[p * 4 + c] / 255;
  }
  return out;
}

/**
 * RGBA pixels → NCHW float32, matching rembg's U²-Net preprocessing:
 * scale by the image's max value, then ImageNet-normalize.
 */
export function toRembgTensor(rgba: Uint8ClampedArray, width: number, height: number): Float32Array {
  const plane = checkSize(rgba, width, height);
  let max = 0;
  for (let i = 0; i < rgba.length; i++) {
    if (i % 4 !== 3 && rgba[i] > max) max = rgba[i];
  }
  const scale = max || 1; // all-black image: avoid dividing by zero
  const out = new Float32Array(plane * 3);
  for (let p = 0; p < plane; p++) {
    for (let c = 0; c < 3; c++) {
      out[c * plane + p] = (rgba[p * 4 + c] / scale - IMAGENET_MEAN[c]) / IMAGENET_STD[c];
    }
  }
  return out;
}

/** Probabilities in [0, 1] → 0–255 alpha. For calibrated models (Studio). */
export function probToAlpha(pred: Float32Array): Uint8ClampedArray<ArrayBuffer> {
  const alpha = new Uint8ClampedArray(pred.length);
  for (let i = 0; i < pred.length; i++) alpha[i] = pred[i] * 255; // Uint8ClampedArray clamps and rounds
  return alpha;
}

/** Raw model output → 0–255 alpha, min-max stretched (rembg does this for U²-Net). */
export function toAlpha(pred: Float32Array): Uint8ClampedArray<ArrayBuffer> {
  let min = Infinity;
  let max = -Infinity;
  for (const v of pred) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  const alpha = new Uint8ClampedArray(pred.length);
  if (range <= 0) return alpha; // flat prediction: nothing salient
  for (let i = 0; i < pred.length; i++) alpha[i] = ((pred[i] - min) / range) * 255;
  return alpha;
}

/** Alpha bytes → RGBA bytes where only the alpha channel is set, for canvas masking. */
export function alphaToMaskRgba(alpha: Uint8ClampedArray): Uint8ClampedArray<ArrayBuffer> {
  const rgba = new Uint8ClampedArray(alpha.length * 4);
  for (let i = 0; i < alpha.length; i++) rgba[i * 4 + 3] = alpha[i];
  return rgba;
}

/** Nearest-rank percentile (p in [0, 100]) of timing samples. */
export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) throw new Error('no samples');
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}
