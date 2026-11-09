// Source frames → studio frames: cut out, measure, colour-match, crop and place every frame.
import { alphaToMaskRgba } from './tensor';
import { applyGains, channelGains, objectMean, type RGB } from './color';
import { placeFrames, robustBox, smoothBoxes, type Box } from './stabilize';
import { makeShadow, SCENE_SIZE, type StudioFrame } from './scene';
import type { Mask } from './worker-client';

const CROP_MARGIN = 0.02; // padding around the object box, as a fraction of the frame
const SMOOTH_RADIUS = 2; // frames on each side used to steady the object box (height, base)
// The horizontal anchor gets a much wider window: re-centring every frame on a noisy anchor added
// jitter on the test walkaround (3.8% vs 3.1% of object height per frame), while this only removes
// slow aim drift and left jitter at the raw level (3.2%).
const ANCHOR_RADIUS = 6;
const MIN_FRAMES_FOR_FULL_TURN = 8; // fewer views than this probably isn't a full rotation, so don't wrap

export interface BuildResult {
  frames: StudioFrame[];
  dropped: number; // frames where no object was found
  meanInferMs: number;
}

interface Measured {
  original: ImageBitmap;
  box: Box;
  crop: { x: number; y: number; w: number; h: number };
  pixels: ImageData;
  mean: RGB;
}

const work = new OffscreenCanvas(1, 1);
const maskCanvas = new OffscreenCanvas(1, 1);

function measure(original: ImageBitmap, mask: Mask): Measured | null {
  const box = robustBox(mask.alpha, mask.size);
  if (!box) return null;
  maskCanvas.width = maskCanvas.height = mask.size;
  maskCanvas.getContext('2d')!.putImageData(new ImageData(alphaToMaskRgba(mask.alpha), mask.size, mask.size), 0, 0);

  work.width = original.width;
  work.height = original.height;
  const ctx = work.getContext('2d', { willReadFrequently: true })!;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, work.width, work.height);
  ctx.drawImage(original, 0, 0);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(maskCanvas, 0, 0, original.width, original.height); // bilinear upscale of the model-size mask

  const { width: W, height: H } = original;
  const x = Math.max(0, Math.floor((box.x0 - CROP_MARGIN) * W));
  const y = Math.max(0, Math.floor((box.y0 - CROP_MARGIN) * H));
  const crop = { x, y, w: Math.min(W, Math.ceil((box.x1 + CROP_MARGIN) * W)) - x, h: Math.min(H, Math.ceil((box.y1 + CROP_MARGIN) * H)) - y };
  const pixels = ctx.getImageData(crop.x, crop.y, crop.w, crop.h);
  const mean = objectMean(pixels.data);
  return mean ? { original, box, crop, pixels, mean } : null;
}

export async function buildFrames(
  sources: ImageBitmap[],
  segment: (source: ImageBitmap) => Promise<Mask>,
  onProgress: (done: number, total: number) => void,
  isCancelled: () => boolean,
): Promise<BuildResult | null> {
  const measured: Measured[] = [];
  let inferMs = 0;
  for (const [i, source] of sources.entries()) {
    const mask = await segment(source);
    if (isCancelled()) return null;
    inferMs += mask.inferMs;
    const m = measure(source, mask);
    if (m) measured.push(m);
    onProgress(i + 1, sources.length);
  }

  // Exposure drifts as a phone walks around an object; match every frame to the median frame.
  const gains = channelGains(measured.map((m) => m.mean));
  const fullTurn = measured.length >= MIN_FRAMES_FOR_FULL_TURN;
  const raw = measured.map((m) => m.box);
  const anchors = smoothBoxes(raw, ANCHOR_RADIUS, fullTurn);
  const boxes = smoothBoxes(raw, SMOOTH_RADIUS, fullTurn).map((b, i) => ({ ...b, cx: anchors[i].cx }));
  const placements = placeFrames(boxes, measured.map((m) => ({ w: m.original.width, h: m.original.height })), SCENE_SIZE);

  const frames: StudioFrame[] = [];
  try {
    for (const [i, m] of measured.entries()) {
      applyGains(m.pixels.data, gains[i]);
      const cutout = await createImageBitmap(m.pixels);
      frames.push({ original: m.original, cutout, cropX: m.crop.x, cropY: m.crop.y, placement: placements[i], shadow: makeShadow(cutout) });
    }
  } catch (err) {
    for (const f of frames) f.cutout.close(); // originals belong to the caller, which closes them
    throw err;
  }
  if (isCancelled()) {
    for (const f of frames) f.cutout.close();
    return null;
  }
  return { frames, dropped: sources.length - measured.length, meanInferMs: inferMs / Math.max(1, sources.length) };
}
