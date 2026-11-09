// A single, self-contained HTML file holding the spin: frames inside as images, plus a tiny viewer.
import { drawStudio, renderBackdrop, SCENE_SIZE, type SceneOptions, type StudioFrame } from './scene';

export const EMBED_SIZE = 800; // sharp at the usual 400–600 px embed size, even on 2× screens
const FULL_TURN_MS = 6000;
const DATA_URI = /^data:image\/(webp|jpeg);base64,[A-Za-z0-9+/]+=*$/;
const CSS_COLOR = /^rgb\(\d{1,3} \d{1,3} \d{1,3}\)$/;

/** The viewer page. Only base64 image data and a validated colour go in, so nothing can inject markup. */
export function buildEmbedHtml(frames: readonly string[], background: string, size = EMBED_SIZE): string {
  if (frames.length === 0) throw new Error('no frames');
  for (const f of frames) if (!DATA_URI.test(f)) throw new Error('frames must be base64 WebP or JPEG data URIs');
  if (!CSS_COLOR.test(background)) throw new Error(`unexpected background colour: ${background}`);
  const n = frames.length;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>360° product view</title>
<style>
html,body{margin:0;height:100%;background:${background}}
body{display:grid;place-items:center;overflow:hidden}
canvas{display:block;width:100vmin;height:100vmin;touch-action:pan-y;cursor:grab}
canvas:active{cursor:grabbing}
canvas:focus-visible{outline:3px solid #e8603c;outline-offset:-3px}
p{position:fixed;left:50%;bottom:10px;translate:-50% 0;margin:0;padding:4px 10px;border-radius:99px;
  font:12px/1.4 system-ui,sans-serif;color:#fff;background:#0009;pointer-events:none;transition:opacity .4s}
</style>
</head>
<body>
<canvas width="${size}" height="${size}" tabindex="0" role="slider" aria-label="360° product view"
  aria-valuemin="1" aria-valuemax="${n}" aria-valuenow="1" aria-valuetext="Frame 1 of ${n}"></canvas>
<p aria-hidden="true">Drag to turn</p>
<script>
const F=${JSON.stringify(frames)};
(()=>{const c=document.querySelector('canvas'),x=c.getContext('2d'),hint=document.querySelector('p'),n=F.length;
const imgs=F.map(s=>{const i=new Image();i.src=s;return i});
let i=0,last=0,drag=null,play=n>1&&!matchMedia('(prefers-reduced-motion: reduce)').matches;
const show=k=>{i=((k%n)+n)%n;if(!imgs[i].complete)return;x.drawImage(imgs[i],0,0,c.width,c.height);
c.setAttribute('aria-valuenow',i+1);c.setAttribute('aria-valuetext','Frame '+(i+1)+' of '+n)};
const stop=()=>{play=false;hint.style.opacity=0};
const tick=t=>{if(play&&t-last>${FULL_TURN_MS}/n){last=t;show(i+1)}requestAnimationFrame(tick)};
imgs[0].decode().then(()=>show(0));
Promise.all(imgs.map(im=>im.decode())).then(()=>requestAnimationFrame(tick));
c.onpointerdown=e=>{if(e.button||n<2)return;stop();drag={x:e.clientX,i,id:e.pointerId};c.setPointerCapture(e.pointerId)};
c.onpointermove=e=>{if(drag&&e.pointerId===drag.id)show(drag.i-Math.round((e.clientX-drag.x)/(c.clientWidth/n)))};
c.onpointerup=c.onpointercancel=()=>{drag=null};
c.onkeydown=e=>{const t={ArrowRight:i+1,ArrowLeft:i-1,Home:0,End:n-1}[e.key];
if(t!==undefined){e.preventDefault();stop();show(t)}else if(e.key===' '){e.preventDefault();play=!play}};
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

/** Render every frame on the chosen backdrop and package them as one HTML file. */
export async function makeEmbed(frames: StudioFrame[], opts: SceneOptions, onProgress: (fraction: number) => void): Promise<Blob> {
  const backdrop = renderBackdrop(opts);
  const scene = new OffscreenCanvas(SCENE_SIZE, SCENE_SIZE);
  const small = new OffscreenCanvas(EMBED_SIZE, EMBED_SIZE);
  const sctx = small.getContext('2d')!;
  sctx.imageSmoothingQuality = 'high';
  const uris: string[] = [];
  for (const [i, frame] of frames.entries()) {
    drawStudio(scene.getContext('2d')!, frame, backdrop, opts);
    sctx.drawImage(scene, 0, 0, EMBED_SIZE, EMBED_SIZE);
    let blob = await small.convertToBlob({ type: 'image/webp', quality: 0.8 });
    if (blob.type !== 'image/webp') blob = await small.convertToBlob({ type: 'image/jpeg', quality: 0.85 }); // Safari can't encode WebP
    uris.push(await toDataUri(blob));
    onProgress((i + 1) / frames.length);
  }
  const [r, g, b] = backdrop.getContext('2d')!.getImageData(2, 2, 1, 1).data; // page colour = the wall's top corner
  return new Blob([buildEmbedHtml(uris, `rgb(${r} ${g} ${b})`)], { type: 'text/html' });
}
