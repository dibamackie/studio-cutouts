// Drawing the studio: backdrop, contact shadow, floor reflection and the cut-out object.
import { parseHex, shade } from './color';
import { LAYOUT, type Placement } from './stabilize';

export const SCENE_SIZE = 1080; // square output, the common size for listings and social posts

export type BackdropId = 'white' | 'gradient' | 'showroom' | 'custom';

export interface SceneOptions {
  backdrop: BackdropId;
  custom: string; // #rrggbb, used when backdrop is 'custom'
  reflection: boolean;
}

export interface StudioFrame {
  original: ImageBitmap;
  cutout: ImageBitmap; // the object only, cropped, colour-matched
  cropX: number; // where the crop sits in the original, in source pixels
  cropY: number;
  placement: Placement;
  shadow: OffscreenCanvas;
}

interface Style {
  stops: [number, string][]; // vertical gradient from the top of the wall to the front of the floor
  glow: string; // light pool behind the object
  shadow: number; // contact shadow opacity
  reflection: number; // reflection opacity at the floor line
}

function styleFor(opts: SceneOptions): Style {
  const g = LAYOUT.groundY;
  switch (opts.backdrop) {
    case 'white':
      return { stops: [[0, '#f4f3f0'], [g - 0.08, '#fbfbfa'], [g + 0.05, '#efeeeb'], [1, '#e2e0dc']], glow: 'rgb(255 255 255 / 0.7)', shadow: 0.42, reflection: 0.16 };
    case 'gradient':
      return { stops: [[0, '#f6d5c4'], [g - 0.05, '#efc6d4'], [g + 0.05, '#e3bfd6'], [1, '#c9a8cf']], glow: 'rgb(255 245 240 / 0.55)', shadow: 0.32, reflection: 0.14 };
    case 'showroom':
      return { stops: [[0, '#26262b'], [g - 0.06, '#34343a'], [g + 0.04, '#1b1b1f'], [1, '#0d0d10']], glow: 'rgb(255 255 255 / 0.13)', shadow: 0.65, reflection: 0.3 };
    case 'custom': {
      const rgb = parseHex(opts.custom);
      return {
        stops: [[0, shade(rgb, -0.08)], [g - 0.06, shade(rgb, 0.12)], [g + 0.05, shade(rgb, -0.02)], [1, shade(rgb, -0.22)]],
        glow: 'rgb(255 255 255 / 0.3)',
        shadow: 0.45,
        reflection: 0.18,
      };
    }
  }
}

/**
 * The empty set, drawn once per backdrop choice and reused for every frame. For a tall canvas (9:16)
 * the square scene sits in the middle and the wall and floor simply continue above and below it.
 */
export function renderBackdrop(opts: SceneOptions, width = SCENE_SIZE, height = width): OffscreenCanvas {
  const style = styleFor(opts);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  const top = sceneTop(width, height);
  const sweep = ctx.createLinearGradient(0, 0, 0, height);
  for (const [at, color] of style.stops) sweep.addColorStop(Math.min(1, Math.max(0, (top + at * width) / height)), color);
  ctx.fillStyle = sweep;
  ctx.fillRect(0, 0, width, height);
  const cx = width / 2;
  const cy = top + (LAYOUT.groundY - 0.18) * width;
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, width * 0.62);
  glow.addColorStop(0, style.glow);
  glow.addColorStop(1, 'rgb(255 255 255 / 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
  return canvas;
}

/** Where the square scene starts vertically on a canvas of this shape (0 for a square). */
export const sceneTop = (width: number, height: number) => (height - width) / 2;

/** Optional framing of the scene layer (object, shadow, reflection) on top of the backdrop. */
export interface View {
  offsetY?: number; // move the square scene down, e.g. to centre it on a 9:16 canvas
  zoom?: number; // push in toward the object, 1 = none
}

/** The object's silhouette, squashed flat and tiny: upscaling it later blurs it into a soft contact shadow. */
export function makeShadow(cutout: ImageBitmap): OffscreenCanvas {
  const canvas = new OffscreenCanvas(48, 6);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(cutout, 0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

let scratch: OffscreenCanvas | null = null; // reused reflection layer

export function drawStudio(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  frame: StudioFrame,
  backdrop: OffscreenCanvas,
  opts: SceneOptions,
  view: View = {},
) {
  const size = SCENE_SIZE; // placements are computed for a SCENE_SIZE square
  const style = styleFor(opts);
  const { scale, dx, dy } = frame.placement;
  const x = frame.cropX * scale + dx;
  const y = frame.cropY * scale + dy;
  const w = frame.cutout.width * scale;
  const h = frame.cutout.height * scale;
  const groundY = LAYOUT.groundY * size;

  ctx.drawImage(backdrop, 0, 0);
  ctx.save();
  ctx.translate(0, view.offsetY ?? 0);
  const zoom = view.zoom ?? 1;
  if (zoom !== 1) {
    const focusY = groundY - (LAYOUT.objectHeight * size) / 2; // zoom about the middle of the object
    ctx.translate(size / 2, focusY);
    ctx.scale(zoom, zoom);
    ctx.translate(-size / 2, -focusY);
  }

  const shadowW = w * 1.05;
  const shadowH = Math.max(8, h * 0.08);
  ctx.globalAlpha = style.shadow;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(frame.shadow, x + (w - shadowW) / 2, groundY - shadowH * 0.55, shadowW, shadowH);
  ctx.globalAlpha = 1;

  if (opts.reflection) {
    const depth = Math.ceil(size - groundY);
    if (!scratch || scratch.width !== size || scratch.height !== depth) scratch = new OffscreenCanvas(size, depth);
    const r = scratch.getContext('2d')!;
    r.setTransform(1, 0, 0, 1, 0, 0);
    r.globalCompositeOperation = 'source-over';
    r.clearRect(0, 0, size, depth);
    r.setTransform(1, 0, 0, -1, 0, groundY); // mirror about the floor line
    r.drawImage(frame.cutout, x, y, w, h);
    r.setTransform(1, 0, 0, 1, 0, 0);
    r.globalCompositeOperation = 'destination-in';
    const fade = r.createLinearGradient(0, 0, 0, depth * 0.75);
    fade.addColorStop(0, `rgb(0 0 0 / ${style.reflection})`);
    fade.addColorStop(1, 'rgb(0 0 0 / 0)');
    r.fillStyle = fade;
    r.fillRect(0, 0, size, depth);
    ctx.drawImage(scratch, 0, groundY);
  }

  ctx.drawImage(frame.cutout, x, y, w, h);
  ctx.restore();
}

/** The untouched source frame, letterboxed, for the before/after toggle. */
export function drawOriginal(ctx: CanvasRenderingContext2D, image: ImageBitmap, size = SCENE_SIZE) {
  const s = Math.min(size / image.width, size / image.height);
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(image, (size - image.width * s) / 2, (size - image.height * s) / 2, image.width * s, image.height * s);
}
