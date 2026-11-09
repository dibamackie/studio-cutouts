// A single, self-contained HTML file holding the spin: frames inside as images, plus a tiny viewer.
import { drawOriginal, drawStudio, renderBackdrop, SCENE_SIZE, type SceneOptions, type StudioFrame } from './scene';

export const EMBED_SIZE = 800; // sharp at the usual 400–600 px embed size, even on 2× screens
const FULL_TURN_MS = 6000;
const DATA_URI = /^data:image\/(webp|jpeg);base64,[A-Za-z0-9+/]+=*$/;
const CSS_COLOR = /^rgb\(\d{1,3} \d{1,3} \d{1,3}\)$/;

export interface EmbedOptions {
  /** The untouched source frames, same count and order as the studio frames; adds a "Show original" toggle. */
  originals?: readonly string[];
  size?: number;
}

function checkFrames(frames: readonly string[], what: string) {
  for (const f of frames) if (!DATA_URI.test(f)) throw new Error(`${what} must be base64 WebP or JPEG data URIs`);
}

/**
 * The viewer page. Only base64 image data and a validated colour go in, so nothing can inject markup.
 * Autoplay has a Play/Pause button: moving content that lasts more than 5 s needs a way to stop it.
 */
export function buildEmbedHtml(frames: readonly string[], background: string, options: EmbedOptions = {}): string {
  const { originals, size = EMBED_SIZE } = options;
  if (frames.length === 0) throw new Error('no frames');
  checkFrames(frames, 'frames');
  if (originals) {
    if (originals.length !== frames.length) throw new Error('originals must match the frames one to one');
    checkFrames(originals, 'originals');
  }
  if (!CSS_COLOR.test(background)) throw new Error(`unexpected background colour: ${background}`);
  const n = frames.length;
  const controls = [
    n > 1 ? '<button type="button" id="play" aria-pressed="true">Pause</button>' : '',
    originals ? '<button type="button" id="view" aria-pressed="false">Show original</button>' : '',
  ].join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>360° product view</title>
<style>
html,body{margin:0;height:100%;background:${background}}
body{display:grid;place-items:center;overflow:hidden;font:13px/1.4 system-ui,sans-serif}
canvas{display:block;width:100vmin;height:100vmin;touch-action:pan-y;cursor:grab}
canvas:active{cursor:grabbing}
canvas:focus-visible,button:focus-visible{outline:3px solid #e8603c;outline-offset:-3px}
p{position:fixed;left:50%;bottom:${controls ? 52 : 10}px;translate:-50% 0;margin:0;padding:4px 10px;border-radius:99px;
  color:#fff;background:#0009;pointer-events:none;transition:opacity .4s;white-space:nowrap}
nav{position:fixed;left:50%;bottom:10px;translate:-50% 0;display:flex;gap:6px}
button{font:inherit;color:#fff;background:#000b;border:0;border-radius:99px;padding:6px 13px;cursor:pointer}
button:hover{background:#000d}
</style>
</head>
<body>
<canvas width="${size}" height="${size}" tabindex="0" role="slider" aria-label="360° product view"
  aria-valuemin="1" aria-valuemax="${n}" aria-valuenow="1" aria-valuetext="Frame 1 of ${n}"></canvas>
<p aria-hidden="true">Drag to turn</p>
${controls ? `<nav aria-label="Viewer controls">${controls}</nav>` : ''}
<script>
const F=${JSON.stringify(frames)};
const O=${JSON.stringify(originals ?? [])};
(()=>{const c=document.querySelector('canvas'),x=c.getContext('2d'),hint=document.querySelector('p'),n=F.length;
const playBtn=document.getElementById('play'),viewBtn=document.getElementById('view');
const load=list=>list.map(s=>{const i=new Image();i.src=s;return i});
const studio=load(F),orig=load(O);
let set=studio,i=0,last=0,drag=null,play=n>1&&!matchMedia('(prefers-reduced-motion: reduce)').matches;
const show=k=>{i=((k%n)+n)%n;if(!set[i].complete)return;x.drawImage(set[i],0,0,c.width,c.height);
c.setAttribute('aria-valuenow',i+1);c.setAttribute('aria-valuetext','Frame '+(i+1)+' of '+n)};
const setPlay=on=>{play=on&&n>1;if(playBtn){playBtn.textContent=play?'Pause':'Play';playBtn.setAttribute('aria-pressed',play)}};
const stop=()=>{setPlay(false);hint.style.opacity=0};
const tick=t=>{if(play&&t-last>${FULL_TURN_MS}/n){last=t;show(i+1)}requestAnimationFrame(tick)};
setPlay(play);
studio[0].decode().then(()=>show(0));
Promise.all(studio.map(im=>im.decode())).then(()=>requestAnimationFrame(tick));
c.onpointerdown=e=>{if(e.button||n<2)return;stop();drag={x:e.clientX,i,id:e.pointerId};c.setPointerCapture(e.pointerId)};
c.onpointermove=e=>{if(drag&&e.pointerId===drag.id)show(drag.i-Math.round((e.clientX-drag.x)/(c.clientWidth/n)))};
c.onpointerup=c.onpointercancel=()=>{drag=null};
c.onkeydown=e=>{const t={ArrowRight:i+1,ArrowLeft:i-1,Home:0,End:n-1}[e.key];
if(t!==undefined){e.preventDefault();stop();show(t)}else if(e.key===' '){e.preventDefault();setPlay(!play)}};
if(playBtn)playBtn.onclick=()=>{setPlay(!play);if(!play)hint.style.opacity=0};
if(viewBtn)viewBtn.onclick=()=>{const toOrig=set===studio;set=toOrig?orig:studio;
viewBtn.textContent=toOrig?'Show studio':'Show original';viewBtn.setAttribute('aria-pressed',toOrig);
if(set[i].complete)show(i);else set[i].decode().then(()=>show(i))};
})();
</script>
</body>
</html>
`;
}

/** The iframe code to paste into a site that hosts the file. */
export function embedSnippet(url: string): string {
  return `<iframe src="${url}" width="600" height="600" style="border:0;max-width:100%;height:auto;aspect-ratio:1" loading="lazy" title="360° product view"></iframe>`;
}

async function toDataUri(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type};base64,${btoa(binary)}`;
}

async function encode(canvas: OffscreenCanvas): Promise<string> {
  let blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 });
  if (blob.type !== 'image/webp') blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 }); // Safari can't encode WebP
  return toDataUri(blob);
}

/**
 * Render every frame on the chosen backdrop and package them as one HTML file. With `includeOriginals`,
 * the source photos go in too (letterboxed), for a before/after toggle; they show the original background.
 */
export async function makeEmbed(
  frames: StudioFrame[],
  opts: SceneOptions,
  onProgress: (fraction: number) => void,
  includeOriginals = false,
): Promise<Blob> {
  const backdrop = renderBackdrop(opts);
  const scene = new OffscreenCanvas(SCENE_SIZE, SCENE_SIZE);
  const sceneCtx = scene.getContext('2d')!;
  const small = new OffscreenCanvas(EMBED_SIZE, EMBED_SIZE);
  const sctx = small.getContext('2d')!;
  sctx.imageSmoothingQuality = 'high';
  const studio: string[] = [];
  const originals: string[] = [];
  for (const [i, frame] of frames.entries()) {
    drawStudio(sceneCtx, frame, backdrop, opts);
    sctx.drawImage(scene, 0, 0, EMBED_SIZE, EMBED_SIZE);
    studio.push(await encode(small));
    if (includeOriginals) {
      drawOriginal(sceneCtx, frame.original);
      sctx.drawImage(scene, 0, 0, EMBED_SIZE, EMBED_SIZE);
      originals.push(await encode(small));
    }
    onProgress((i + 1) / frames.length);
  }
  const [r, g, b] = backdrop.getContext('2d')!.getImageData(2, 2, 1, 1).data; // page colour = the wall's top corner
  return new Blob([buildEmbedHtml(studio, `rgb(${r} ${g} ${b})`, includeOriginals ? { originals } : {})], { type: 'text/html' });
}
