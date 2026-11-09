import './style.css';
import { DEFAULT_MODEL, isModelId, MODELS, type Backend } from './models';
import type { Probe } from './protocol';
import { createSegmenter } from './worker-client';
import { InputError, loadFrames } from './frames';
import { buildFrames } from './pipeline';
import { drawOriginal, drawStudio, renderBackdrop, SCENE_SIZE, type BackdropId, type SceneOptions, type StudioFrame } from './scene';
import { createSpin } from './spin';

const requested = new URLSearchParams(location.search).get('model'); // ?model=u2netp compares against the baseline
const model = MODELS[isModelId(requested) ? requested : DEFAULT_MODEL];
// shortcut: the probe's verdict is kept until storage is cleared; bump the key's version if the model or runtime changes speed
const BACKEND_KEY = `studio.backend.v1.${model.id}`;
const BACKDROPS: readonly BackdropId[] = ['white', 'gradient', 'showroom', 'custom'];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fileInput = $<HTMLInputElement>('file');
const dropZone = $<HTMLLabelElement>('drop');
const stage = $<HTMLElement>('stage');
const canvas = $<HTMLCanvasElement>('scene');
const status = $<HTMLParagraphElement>('status');
const playButton = $<HTMLButtonElement>('play');
const frameCount = $<HTMLSpanElement>('frame');
const spinHint = $<HTMLParagraphElement>('spin-hint');
const toggle = $<HTMLButtonElement>('toggle');
const customColor = $<HTMLInputElement>('custom-color');
const reflection = $<HTMLInputElement>('reflection');
const readout = { model: $('m-model'), backend: $('m-backend'), load: $('m-load'), infer: $('m-infer'), frames: $('m-frames'), size: $('m-size') };

const setStatus = (text: string) => (status.textContent = text);

function storedBackend(): Backend | undefined {
  try {
    const value = localStorage.getItem(BACKEND_KEY);
    return value === 'webgpu' || value === 'wasm' ? value : undefined;
  } catch {
    return undefined; // storage blocked (private mode, sandboxed preview): just probe again
  }
}

function rememberBackend(backend: Backend) {
  try {
    localStorage.setItem(BACKEND_KEY, backend);
  } catch {
    // best-effort: without storage the next visit probes again
  }
}

function readyMessage(backend: Backend, probe: Probe | undefined): string {
  if (!probe) return 'Model ready. Runs entirely in your browser.';
  if (probe.webgpuMs === null) return 'Model ready on the CPU: WebGPU did not start on this device.';
  const times = `GPU ${Math.round(probe.webgpuMs)} ms vs CPU ${Math.round(probe.wasmMs)} ms per frame`;
  return backend === 'webgpu' ? `Model ready on the GPU (${times}).` : `Model ready on the CPU: it beat the GPU on this device (${times}).`;
}

// ---- Model ----

let readyText = 'Loading model…';
let busy = false;
readout.model.textContent = `${model.label} · ${model.megabytes} MB`;
const segmenter = createSegmenter(model, storedBackend(), (loaded, total) => {
  const pct = total ? `${Math.round((loaded / total) * 100)}%` : `${(loaded / 1e6).toFixed(1)} MB`;
  setStatus(`Loading model… ${pct}`);
});
segmenter.ready.then(
  (r) => {
    readout.backend.textContent = `${r.backend === 'webgpu' ? 'WebGPU' : 'WASM (CPU)'} · ${r.inputSize}px`;
    readout.load.textContent = `${Math.round(r.loadMs)} ms`;
    if (r.probe) rememberBackend(r.backend);
    readyText = readyMessage(r.backend, r.probe);
    if (!busy) setStatus(readyText);
  },
  (err: Error) => setStatus(`The model failed to load: ${err.message}`),
);

// ---- Scene and viewer ----

const ctx = canvas.getContext('2d')!;
const options: SceneOptions = { backdrop: 'white', custom: customColor.value, reflection: reflection.checked };
let backdrop = renderBackdrop(options);
let frames: StudioFrame[] = [];
let showingOriginal = false;
let generation = 0;

function draw(i: number) {
  const frame = frames[i];
  if (!frame) return;
  if (showingOriginal) drawOriginal(ctx, frame.original);
  else drawStudio(ctx, frame, backdrop, options);
}

const spin = createSpin(canvas, draw, (i, n, playing) => {
  frameCount.textContent = `${i + 1} / ${n}`;
  playButton.textContent = playing ? 'Pause' : 'Play';
  playButton.setAttribute('aria-pressed', String(playing));
  // A spin is announced as a slider (value = frame); a single photo is just an image.
  if (n > 1) {
    canvas.setAttribute('role', 'slider');
    canvas.setAttribute('aria-label', '360° studio view');
    canvas.setAttribute('aria-valuemin', '1');
    canvas.setAttribute('aria-valuemax', String(n));
    canvas.setAttribute('aria-valuenow', String(i + 1));
    canvas.setAttribute('aria-valuetext', `Frame ${i + 1} of ${n}`);
  } else {
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Studio view of the cut-out product');
    for (const a of ['aria-valuemin', 'aria-valuemax', 'aria-valuenow', 'aria-valuetext']) canvas.removeAttribute(a);
  }
});

function clearFrames() {
  spin.setCount(0);
  for (const f of frames) {
    f.original.close();
    f.cutout.close();
  }
  frames = [];
}

function setOriginal(on: boolean) {
  showingOriginal = on;
  toggle.textContent = on ? 'Show studio' : 'Show original';
  toggle.setAttribute('aria-pressed', String(on));
  spin.redraw();
}

async function handleFiles(files: File[]) {
  if (files.length === 0) return;
  const gen = ++generation;
  const cancelled = () => gen !== generation;
  busy = true;
  clearFrames();
  stage.hidden = true;
  dropZone.classList.add('compact');
  readout.infer.textContent = readout.frames.textContent = '…';
  let sources: ImageBitmap[] = [];
  try {
    const loaded = await loadFrames(files, setStatus, cancelled);
    sources = loaded.frames;
    if (cancelled()) return;
    readout.size.textContent = `${sources[0].width}×${sources[0].height}`;
    await segmenter.ready;
    const result = await buildFrames(
      sources,
      (s) => segmenter.segment(s),
      (done, total) => {
        if (!cancelled()) setStatus(total > 1 ? `Cutting out frame ${done} of ${total}…` : 'Cutting out…');
      },
      cancelled,
    );
    if (!result) return;
    if (result.frames.length === 0) throw new InputError(`no clear object was found in that ${loaded.kind === 'video' ? 'video' : 'photo'}`);
    frames = result.frames;
    const kept = new Set(frames.map((f) => f.original));
    sources = sources.filter((s) => !kept.has(s)); // frames own their originals now; the rest get closed below

    readout.infer.textContent = `${result.meanInferMs.toFixed(1)} ms/frame`;
    readout.frames.textContent = `${frames.length}${result.dropped ? ` (${result.dropped} skipped)` : ''}`;
    const isSpin = frames.length > 1;
    playButton.hidden = frameCount.hidden = spinHint.hidden = !isSpin;
    stage.hidden = false;
    setOriginal(false);
    spin.setCount(frames.length);
    setStatus(isSpin ? `Done: a ${frames.length}-frame 360° spin, cut out on-device.` : 'Done. Background removed on-device.');
  } catch (err) {
    if (cancelled()) return;
    setStatus(err instanceof InputError ? `Can't use that: ${err.message}.` : `Something went wrong: ${String(err)}`);
    console.error(err);
  } finally {
    for (const s of sources) s.close();
    if (gen === generation) busy = false;
  }
}

// ---- Exports ----

function save(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function exportFrame(kind: 'png' | 'jpg') {
  const frame = frames[spin.index];
  if (!frame) return;
  try {
    if (kind === 'png') {
      const out = new OffscreenCanvas(frame.cutout.width, frame.cutout.height);
      out.getContext('2d')!.drawImage(frame.cutout, 0, 0);
      save(await out.convertToBlob({ type: 'image/png' }), 'cutout.png');
    } else {
      const out = new OffscreenCanvas(SCENE_SIZE, SCENE_SIZE);
      drawStudio(out.getContext('2d')!, frame, backdrop, options);
      save(await out.convertToBlob({ type: 'image/jpeg', quality: 0.92 }), 'studio.jpg');
    }
  } catch (err) {
    setStatus(`Export failed: ${String(err)}`);
  }
}

// ---- Wiring ----

fileInput.addEventListener('change', () => handleFiles([...(fileInput.files ?? [])]));
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('over');
  handleFiles([...(e.dataTransfer?.files ?? [])]);
});
window.addEventListener('paste', (e) => handleFiles([...(e.clipboardData?.files ?? [])]));

function updateScene() {
  backdrop = renderBackdrop(options);
  spin.redraw();
}
for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="backdrop"]')) {
  radio.addEventListener('change', () => {
    if (BACKDROPS.includes(radio.value as BackdropId)) options.backdrop = radio.value as BackdropId;
    updateScene();
  });
}
customColor.addEventListener('input', () => {
  options.custom = customColor.value;
  options.backdrop = 'custom';
  $<HTMLInputElement>('bd-custom').checked = true;
  updateScene();
});
reflection.addEventListener('change', () => {
  options.reflection = reflection.checked;
  spin.redraw();
});

const sampleButton = $<HTMLButtonElement>('sample');
sampleButton.addEventListener('click', async () => {
  sampleButton.disabled = true;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}samples/mug-walkaround.mp4`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await handleFiles([new File([await res.blob()], 'mug-walkaround.mp4', { type: 'video/mp4' })]);
  } catch (err) {
    setStatus(`Could not load the sample: ${String(err)}`);
  } finally {
    sampleButton.disabled = false;
  }
});
toggle.addEventListener('click', () => setOriginal(!showingOriginal));
playButton.addEventListener('click', () => (spin.playing ? spin.pause() : spin.play()));
$('download').addEventListener('click', () => exportFrame('png'));
$('download-jpg').addEventListener('click', () => exportFrame('jpg'));
$('reset').addEventListener('click', () => {
  generation++;
  busy = false;
  clearFrames();
  stage.hidden = true;
  dropZone.classList.remove('compact');
  fileInput.value = '';
  setStatus(readyText);
});
