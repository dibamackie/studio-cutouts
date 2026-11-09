// A vertical (9:16) clip for social media: an orbit for a spin, a slow push-in for a single photo.
import { drawStudio, renderBackdrop, sceneTop, type SceneOptions, type StudioFrame } from './scene';

export const CLIP = { width: 1080, height: 1920, fps: 30 } as const;
const TURN_SECONDS = 4; // one full orbit; the clip shows two, so it loops seamlessly
const TURNS = 2;
const PUSH_IN_SECONDS = 5;
const PUSH_IN_ZOOM = 1.08;
const HOLD = 0.6; // show each view cleanly for 60% of its slot, crossfade in the rest: smooth without double images
const MAX_FILL = 0.94; // the widest view may use this much of the clip's width
const MAX_ZOOM = 1.3;

/** How far the scene can be enlarged in the tall frame before the widest view would touch the sides. */
export function fillZoom(objectWidths: readonly number[], frameWidth: number): number {
  const widest = Math.max(1, ...objectWidths);
  return Math.max(1, Math.min(MAX_ZOOM, (MAX_FILL * frameWidth) / widest));
}

/** Which two spin frames are on screen at time t, and how far the crossfade between them has got. */
export function spinBlend(t: number, count: number, turnSeconds = TURN_SECONDS): { a: number; b: number; mix: number } {
  if (count < 1) throw new Error('no frames');
  const pos = (((t / turnSeconds) * count) % count + count) % count;
  const a = Math.floor(pos);
  return { a, b: (a + 1) % count, mix: pos - a };
}

/** Ease-in-out zoom from 1 to `maxZoom` over `duration` seconds. */
export function pushInZoom(t: number, duration = PUSH_IN_SECONDS, maxZoom = PUSH_IN_ZOOM): number {
  const p = Math.min(1, Math.max(0, t / duration));
  const eased = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
  return 1 + (maxZoom - 1) * eased;
}

export const clipSeconds = (frameCount: number) => (frameCount > 1 ? TURN_SECONDS * TURNS : PUSH_IN_SECONDS);

/** Returns a function that paints the clip's frame at time t onto `target`. */
function painter(frames: StudioFrame[], opts: SceneOptions, target: OffscreenCanvas | HTMLCanvasElement) {
  const { width, height } = CLIP;
  const backdrop = renderBackdrop(opts, width, height);
  const offsetY = sceneTop(width, height);
  const out = target.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  const layerA = new OffscreenCanvas(width, height);
  const layerB = new OffscreenCanvas(width, height);
  const zoom = fillZoom(frames.map((f) => f.cutout.width * f.placement.scale), width);
  return (t: number) => {
    if (frames.length === 1) {
      drawStudio(out, frames[0], backdrop, opts, { offsetY, zoom: zoom * pushInZoom(t) });
      return;
    }
    // Crossfade neighbouring frames (late in each slot) so 36 views read as smooth motion at 30 fps.
    const { a, b, mix } = spinBlend(t, frames.length);
    const fade = Math.max(0, (mix - HOLD) / (1 - HOLD));
    drawStudio(layerA.getContext('2d')!, frames[a], backdrop, opts, { offsetY, zoom });
    out.globalAlpha = 1;
    out.drawImage(layerA, 0, 0);
    if (fade > 0.02) {
      drawStudio(layerB.getContext('2d')!, frames[b], backdrop, opts, { offsetY, zoom });
      out.globalAlpha = fade;
      out.drawImage(layerB, 0, 0);
      out.globalAlpha = 1;
    }
  };
}

export interface Clip {
  blob: Blob;
  extension: 'mp4' | 'webm';
  encoder: 'webcodecs' | 'mediarecorder';
}

/** Encode faster than real time with WebCodecs (via Mediabunny); record in real time as a fallback. */
export async function makeClip(frames: StudioFrame[], opts: SceneOptions, onProgress: (fraction: number) => void): Promise<Clip> {
  if (frames.length === 0) throw new Error('no frames to export');
  const { width, height, fps } = CLIP;
  const total = Math.round(clipSeconds(frames.length) * fps);
  const mb = await import('mediabunny'); // ~180 KB gzipped, so it's only loaded when someone exports a clip
  const codec = await mb.getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], { width, height });
  if (!codec) return recordRealtime(frames, opts, onProgress);

  const canvas = new OffscreenCanvas(width, height);
  const paint = painter(frames, opts, canvas);
  const isMp4 = codec === 'avc'; // H.264 in MP4 is what every social platform accepts
  const target = new mb.BufferTarget();
  const output = new mb.Output({ format: isMp4 ? new mb.Mp4OutputFormat() : new mb.WebMOutputFormat(), target });
  const source = new mb.CanvasSource(canvas, { codec, quality: mb.QUALITY_HIGH, keyFrameInterval: 1 });
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();
  try {
    for (let i = 0; i < total; i++) {
      paint(i / fps);
      await source.add(i / fps, 1 / fps);
      if (i % 10 === 0) onProgress(i / total);
    }
    await output.finalize();
  } catch (err) {
    await output.cancel().catch(() => undefined);
    throw err;
  }
  if (!target.buffer) throw new Error('the encoder produced no output');
  onProgress(1);
  return { blob: new Blob([target.buffer], { type: isMp4 ? 'video/mp4' : 'video/webm' }), extension: isMp4 ? 'mp4' : 'webm', encoder: 'webcodecs' };
}

/** For browsers without a WebCodecs encoder: play the clip on a canvas and record it as it plays. */
async function recordRealtime(frames: StudioFrame[], opts: SceneOptions, onProgress: (fraction: number) => void): Promise<Clip> {
  if (typeof MediaRecorder === 'undefined') throw new Error('this browser cannot encode video');
  const canvas = document.createElement('canvas');
  canvas.width = CLIP.width;
  canvas.height = CLIP.height;
  const paint = painter(frames, opts, canvas);
  const mimeType = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
  if (!mimeType) throw new Error('this browser cannot record video');
  paint(0);
  const recorder = new MediaRecorder(canvas.captureStream(CLIP.fps), { mimeType, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
  const seconds = clipSeconds(frames.length);
  recorder.start();
  const t0 = performance.now();
  await new Promise<void>((resolve) => {
    const step = () => {
      const t = (performance.now() - t0) / 1000;
      if (t >= seconds) return resolve();
      paint(t);
      onProgress(t / seconds);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  recorder.stop();
  await stopped;
  const isMp4 = mimeType.startsWith('video/mp4');
  return { blob: new Blob(chunks, { type: isMp4 ? 'video/mp4' : 'video/webm' }), extension: isMp4 ? 'mp4' : 'webm', encoder: 'mediarecorder' };
}
