// Pure pre/post-processing for salient-object models. No DOM, so it is unit-testable.

export const IMAGENET_MEAN = [0.485, 0.456, 0.406] as const;
export const IMAGENET_STD = [0.229, 0.224, 0.225] as const;

/**
 * RGBA pixels (row-major, as from getImageData) → NCHW float32 tensor data.
 * Matches rembg's U²-Net preprocessing: scale by the image's max value, then ImageNet-normalize.
 */
export function toInputTensor(rgba: Uint8ClampedArray, width: number, height: number): Float32Array {
  const plane = width * height;
  if (rgba.length !== plane * 4) {
    throw new Error(`expected ${plane * 4} RGBA bytes, got ${rgba.length}`);
  }
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

/** Raw model output → 0–255 alpha, min-max stretched (rembg does the same). */
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
