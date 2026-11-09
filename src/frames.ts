// Turn dropped files into source frames: one photo, several photos, or frames sampled from a video.
import { pickSharpest, sharpness, toGray } from './sharpness';
import { centerDistance, findLoopEnd } from './loop';

export const SPIN_FRAMES = 36; // 10° per frame for a full turn
export const MAX_PHOTOS = 72;
export const MAX_VIDEO_SECONDS = 60;
const SINGLE_MAX_SIDE = 4096; // shortcut: caps one photo to stay under mobile canvas limits; tile if we ever need more
const SPIN_MAX_SIDE = 1024; // 36 frames at this size is ~100 MB of bitmaps, fine on a phone
const CANDIDATES_PER_FRAME = 3; // score 3 nearby video frames per slot and keep the sharpest
const SCORE_WIDTH = 160; // sharpness is measured on a small copy: fast, and enough to see motion blur
const VIDEO_TIMEOUT_MS = 5000;

export type InputKind = 'photo' | 'photos' | 'video';

/** The user's input can't be used; the message is shown to them. */
export class InputError extends Error {}
/** A newer drop replaced this one; nothing to show. */
export class Cancelled extends Error {}

async function decode(file: File, maxSide: number): Promise<ImageBitmap> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  if (scale === 1) return bitmap;
  try {
    return await createImageBitmap(bitmap, {
      resizeWidth: Math.round(bitmap.width * scale),
      resizeHeight: Math.round(bitmap.height * scale),
      resizeQuality: 'high',
    });
  } finally {
    bitmap.close();
  }
}

/** Resolve on `event`, reject on the video's `error` event or after a timeout; always removes its listeners. */
function waitFor(video: HTMLVideoElement, event: string, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      video.removeEventListener(event, ok);
      video.removeEventListener('error', fail);
    };
    const ok = () => (done(), resolve());
    const fail = () => (done(), reject(new InputError("this browser can't decode that video; try an MP4 (H.264)")));
    const timer = setTimeout(() => (done(), reject(new InputError(`the video took too long to ${what}`))), VIDEO_TIMEOUT_MS);
    video.addEventListener(event, ok);
    video.addEventListener('error', fail);
  });
}

async function seek(video: HTMLVideoElement, t: number) {
  const seeked = waitFor(video, 'seeked', 'seek');
  video.currentTime = t;
  await seeked;
}

async function framesFromVideo(
  file: File,
  onProgress: (text: string) => void,
  check: () => void,
): Promise<{ frames: ImageBitmap[]; turnSeconds: number | null }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  const frames: ImageBitmap[] = [];
  try {
    // Metadata is enough to read the length and start seeking; iOS may never fire 'loadeddata' for a detached video.
    const loaded = waitFor(video, 'loadedmetadata', 'load');
    video.src = url;
    await loaded;
    const { duration, videoWidth: vw, videoHeight: vh } = video;
    if (!Number.isFinite(duration) || duration <= 0 || !vw || !vh) throw new InputError('could not read the video length or size');
    if (duration > MAX_VIDEO_SECONDS) throw new InputError(`the video is ${Math.round(duration)} s long; keep it under ${MAX_VIDEO_SECONDS} s`);

    // Pass 1: score many evenly spaced moments on a small canvas.
    const count = SPIN_FRAMES * CANDIDATES_PER_FRAME;
    const times = Array.from({ length: count }, (_, i) => ((i + 0.5) / count) * duration);
    const sw = SCORE_WIDTH;
    const sh = Math.max(3, Math.round((SCORE_WIDTH * vh) / vw));
    const small = new OffscreenCanvas(sw, sh).getContext('2d', { willReadFrequently: true })!;
    const scores: number[] = [];
    const distanceFromFirst: number[] = [];
    let first: Float32Array | null = null;
    for (const [i, t] of times.entries()) {
      check();
      await seek(video, t);
      small.drawImage(video, 0, 0, sw, sh);
      const gray = toGray(small.getImageData(0, 0, sw, sh).data);
      scores.push(sharpness(gray, sw, sh));
      first ??= gray;
      distanceFromFirst.push(centerDistance(first, gray, sw, sh));
      if (i % 12 === 0) onProgress(`Picking sharp frames… ${Math.round((i / count) * 100)}%`);
    }

    // Turned past 360°? Keep exactly one turn, so the spin's last frame leads seamlessly into its first.
    const loopEnd = findLoopEnd(distanceFromFirst);
    const usable = loopEnd ?? count;

    // Pass 2: grab the sharpest candidate of each slot at full size.
    const scale = Math.min(1, SPIN_MAX_SIDE / Math.max(vw, vh));
    const full = new OffscreenCanvas(Math.round(vw * scale), Math.round(vh * scale));
    const ctx = full.getContext('2d')!;
    for (const i of pickSharpest(scores.slice(0, usable), SPIN_FRAMES)) {
      check();
      await seek(video, times[i]);
      ctx.drawImage(video, 0, 0, full.width, full.height);
      frames.push(await createImageBitmap(full));
    }
    // Only report a trimmed turn when it actually cut something off (a turn ending at the very end is the whole video).
    const trimmed = loopEnd !== null && times[loopEnd] < duration * 0.95;
    return { frames, turnSeconds: trimmed ? times[loopEnd] : null };
  } catch (err) {
    for (const f of frames) f.close();
    throw err;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

async function framesFromPhotos(photos: File[], onProgress: (text: string) => void, check: () => void): Promise<ImageBitmap[]> {
  const frames: ImageBitmap[] = [];
  try {
    for (const [i, file] of photos.entries()) {
      check();
      onProgress(`Reading photos… ${i + 1}/${photos.length}`);
      frames.push(await decode(file, SPIN_MAX_SIDE));
    }
    return frames;
  } catch (err) {
    for (const f of frames) f.close();
    throw err;
  }
}

const stem = (name: string) => name.replace(/\.[^.]+$/, '');

/**
 * Capture order from file names: natural number order, compared without the extension. WhatsApp names
 * photos sent in the same second "x.jpeg", "x (1).jpeg", "x (2).jpeg"; comparing whole names puts
 * "x (1)" before "x.jpeg" (space sorts before dot), which shuffled the first photo of every second.
 */
export function compareFileNames(a: string, b: string): number {
  return stem(a).localeCompare(stem(b), undefined, { numeric: true }) || a.localeCompare(b);
}

/**
 * Decode the dropped files. A video wins over photos; several photos are ordered by file name.
 * Throws `Cancelled` (after freeing what it decoded) as soon as `isCancelled()` turns true.
 */
export async function loadFrames(
  files: File[],
  onProgress: (text: string) => void,
  isCancelled: () => boolean,
): Promise<{ kind: InputKind; frames: ImageBitmap[]; turnSeconds?: number | null }> {
  const check = () => {
    if (isCancelled()) throw new Cancelled();
  };
  const progress = (text: string) => {
    if (!isCancelled()) onProgress(text);
  };
  const video = files.find((f) => f.type.startsWith('video/'));
  if (video) {
    progress('Reading the video…');
    return { kind: 'video', ...(await framesFromVideo(video, progress, check)) };
  }
  const photos = files.filter((f) => f.type.startsWith('image/')).sort((a, b) => compareFileNames(a.name, b.name));
  if (photos.length === 0) throw new InputError('drop a photo, several photos of one object, or a short video');
  if (photos.length === 1) return { kind: 'photo', frames: [await decode(photos[0], SINGLE_MAX_SIDE)] };
  if (photos.length > MAX_PHOTOS) throw new InputError(`that's ${photos.length} photos; use at most ${MAX_PHOTOS}`);
  return { kind: 'photos', frames: await framesFromPhotos(photos, progress, check) };
}
