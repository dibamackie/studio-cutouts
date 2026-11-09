import './style.css';
import { alphaToMaskRgba } from './tensor';
import { DEFAULT_MODEL, isModelId, MODELS, type Backend } from './models';
import type { FromWorker, Probe } from './protocol';

const requested = new URLSearchParams(location.search).get('model'); // ?model=u2netp compares against the baseline
const model = MODELS[isModelId(requested) ? requested : DEFAULT_MODEL];
// shortcut: the probe's verdict is kept until storage is cleared; bump the key's version if the model or runtime changes speed
const BACKEND_KEY = `studio.backend.v1.${model.id}`;
const MAX_SIDE = 4096; // shortcut: caps output resolution to stay under mobile canvas limits; tile if we ever need more

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fileInput = $<HTMLInputElement>('file');
const dropZone = $<HTMLLabelElement>('drop');
const stage = $<HTMLDivElement>('stage');
const canvas = $<HTMLCanvasElement>('result');
const status = $<HTMLParagraphElement>('status');
const toggle = $<HTMLButtonElement>('toggle');
const download = $<HTMLButtonElement>('download');
const reset = $<HTMLButtonElement>('reset');
const readout = {
  model: $('m-model'),
  backend: $('m-backend'),
  load: $('m-load'),
  infer: $('m-infer'),
  size: $('m-size'),
};

const worker = new Worker(new URL('./segment.worker.ts', import.meta.url), { type: 'module' });

let requestId = 0;
let original: ImageBitmap | null = null;
let cutout: HTMLCanvasElement | null = null;
let showingOriginal = false;
let readyText = 'Loading model…';
let markReady: (inputSize: number) => void;
const modelReady = new Promise<number>((resolve) => (markReady = resolve));
readout.model.textContent = `${model.label} · ${model.megabytes} MB`;

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
  return backend === 'webgpu'
    ? `Model ready on the GPU (${times}).`
    : `Model ready on the CPU: it beat the GPU on this device (${times}).`;
}

worker.onmessage = (e: MessageEvent<FromWorker>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'progress': {
      const pct = msg.total ? Math.round((msg.loaded / msg.total) * 100) : null;
      setStatus(pct === null ? `Loading model… ${(msg.loaded / 1e6).toFixed(1)} MB` : `Loading model… ${pct}%`);
      break;
    }
    case 'ready':
      readout.backend.textContent = `${msg.backend === 'webgpu' ? 'WebGPU' : 'WASM (CPU)'} · ${msg.inputSize}px`;
      readout.load.textContent = `${Math.round(msg.loadMs)} ms`;
      if (msg.probe) rememberBackend(msg.backend);
      readyText = readyMessage(msg.backend, msg.probe);
      if (!original) setStatus(readyText);
      markReady(msg.inputSize);
      break;
    case 'result':
      if (msg.id !== requestId || !original) return; // a newer image replaced this one
      readout.infer.textContent = `${msg.inferMs.toFixed(1)} ms`;
      cutout = composite(original, msg.alpha, msg.size);
      showingOriginal = false;
      render();
      setStatus('Done. Background removed on-device.');
      break;
    case 'error':
      if (msg.context === 'segment' && msg.id !== requestId) return;
      setStatus(`Something went wrong: ${msg.message}`);
      console.error(msg.message);
      break;
  }
};
worker.postMessage({ type: 'init', modelId: model.id, preferred: storedBackend() });

function composite(image: ImageBitmap, alpha: Uint8ClampedArray<ArrayBuffer>, size: number): HTMLCanvasElement {
  const mask = document.createElement('canvas');
  mask.width = mask.height = size;
  mask.getContext('2d')!.putImageData(new ImageData(alphaToMaskRgba(alpha), size, size), 0, 0);

  const out = document.createElement('canvas');
  out.width = image.width;
  out.height = image.height;
  const ctx = out.getContext('2d')!;
  ctx.drawImage(image, 0, 0);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(mask, 0, 0, image.width, image.height); // bilinear upscale of the model-size mask
  return out;
}

function render() {
  const source = showingOriginal ? original : cutout;
  if (!source) return;
  canvas.width = source.width;
  canvas.height = source.height;
  canvas.getContext('2d')!.drawImage(source, 0, 0);
  toggle.textContent = showingOriginal ? 'Show cutout' : 'Show original';
  toggle.setAttribute('aria-pressed', String(showingOriginal));
}

async function handleFile(file: File | undefined) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    setStatus('That file is not an image. Try a JPG, PNG or WebP.');
    return;
  }
  const id = ++requestId;
  try {
    let bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale < 1) {
      const big = bitmap;
      bitmap = await createImageBitmap(big, {
        resizeWidth: Math.round(big.width * scale),
        resizeHeight: Math.round(big.height * scale),
        resizeQuality: 'high',
      });
      big.close();
    }
    original?.close();
    original = bitmap;
    cutout = null;
    readout.size.textContent = `${bitmap.width}×${bitmap.height}`;
    readout.infer.textContent = '…';
    stage.hidden = false;
    dropZone.classList.add('compact');
    showingOriginal = true;
    render();

    const inputSize = await modelReady;
    if (id !== requestId) return;
    setStatus('Cutting out…');
    const forModel = await createImageBitmap(bitmap, {
      resizeWidth: inputSize,
      resizeHeight: inputSize,
      resizeQuality: 'high',
    });
    worker.postMessage({ type: 'segment', id, bitmap: forModel }, [forModel]);
  } catch (err) {
    setStatus(`Could not read that image: ${String(err)}`);
  }
}

fileInput.addEventListener('change', () => handleFile(fileInput.files?.[0]));
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('over');
  handleFile(e.dataTransfer?.files[0]);
});
window.addEventListener('paste', (e) => handleFile(e.clipboardData?.files[0]));

toggle.addEventListener('click', () => {
  if (!cutout) return;
  showingOriginal = !showingOriginal;
  render();
});

download.addEventListener('click', () => {
  cutout?.toBlob((blob) => {
    if (!blob) return setStatus('Export failed.');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'cutout.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, 'image/png');
});

reset.addEventListener('click', () => {
  requestId++;
  original?.close();
  original = cutout = null;
  stage.hidden = true;
  dropZone.classList.remove('compact');
  fileInput.value = '';
  setStatus(readyText);
});
