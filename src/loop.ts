// Finding one full turn in a video: where does the object come back to the view it started from?

const CENTER = 0.6; // compare the middle 60% of the frame, where the object is; edges are mostly background
const EARLIEST = 0.4; // a full turn can't end before 40% of the video (that would be 2.5+ turns)
const STRICTNESS = 0.5; // the match must be at least twice as close as a typical frame in the search window

/** Mean absolute difference between the central regions of two grayscale frames of the same size. */
export function centerDistance(a: Float32Array, b: Float32Array, width: number, height: number): number {
  if (a.length !== width * height || b.length !== a.length) throw new Error('frames must match the given size');
  const x0 = Math.floor((width * (1 - CENTER)) / 2);
  const y0 = Math.floor((height * (1 - CENTER)) / 2);
  const x1 = width - x0;
  const y1 = height - y0;
  let sum = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) sum += Math.abs(a[y * width + x] - b[y * width + x]);
  return sum / ((x1 - x0) * (y1 - y0));
}

const median = (v: number[]) => {
  const s = [...v].sort((p, q) => p - q);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Given each candidate frame's distance from the first frame (in time order), return the index where
 * the object has come back to its starting view, i.e. where one full turn ends. Returns null when no
 * moment stands out clearly, in which case the whole video should be used.
 */
export function findLoopEnd(distanceFromFirst: readonly number[]): number | null {
  const n = distanceFromFirst.length;
  const start = Math.ceil(n * EARLIEST);
  if (n < 10 || start >= n) return null;
  let best = start;
  for (let i = start + 1; i < n; i++) if (distanceFromFirst[i] < distanceFromFirst[best]) best = i;
  const typical = median(distanceFromFirst.slice(start));
  return distanceFromFirst[best] <= STRICTNESS * typical ? best : null;
}
