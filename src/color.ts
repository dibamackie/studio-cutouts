// Pure colour helpers: matching exposure across spin frames, and shading backdrop colours.

export type RGB = [number, number, number];

const OPAQUE = 128;
export const MAX_GAIN = 1.25; // never push a channel more than ±25%: beyond that it's a different colour, not flicker

/** Mean colour of the object's pixels (alpha ≥ 50%), or null if there are none. */
export function objectMean(rgba: Uint8ClampedArray): RGB | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < OPAQUE) continue;
    r += rgba[i];
    g += rgba[i + 1];
    b += rgba[i + 2];
    n++;
  }
  return n ? [r / n, g / n, b / n] : null;
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Per-frame, per-channel gains that pull every frame's mean toward the median frame. */
export function channelGains(means: readonly RGB[]): RGB[] {
  if (means.length === 0) return [];
  const target = [0, 1, 2].map((c) => median(means.map((m) => m[c])));
  const clamp = (v: number) => Math.min(MAX_GAIN, Math.max(1 / MAX_GAIN, v));
  return means.map((m) => [0, 1, 2].map((c) => (m[c] > 0 ? clamp(target[c] / m[c]) : 1)) as RGB);
}

/** Multiply RGB in place (the buffer is a scratch copy from getImageData). */
export function applyGains(rgba: Uint8ClampedArray, gains: RGB): void {
  if (gains[0] === 1 && gains[1] === 1 && gains[2] === 1) return;
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] *= gains[0];
    rgba[i + 1] *= gains[1];
    rgba[i + 2] *= gains[2];
  }
}

export function parseHex(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mix toward white (amount > 0) or black (amount < 0), returned as a CSS colour. */
export function shade([r, g, b]: RGB, amount: number): string {
  const t = Math.abs(amount);
  const to = amount >= 0 ? 255 : 0;
  const mix = (c: number) => Math.round(c + (to - c) * t);
  return `rgb(${mix(r)} ${mix(g)} ${mix(b)})`;
}
