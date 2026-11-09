/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/webgpu';
import { MODELS, pickBackend, type Backend, type ModelId, type ModelSpec } from './models';
import { percentile, probToAlpha, toAlpha, toRembgTensor, toUnitTensor } from './tensor';
import type { FromWorker, Probe, ToWorker } from './protocol';

// shortcut: multithreaded WASM hangs when ORT starts inside a Web Worker (verified on 1.31.1);
// with Studio v1 the single-thread CPU path is ~200 ms/frame, which is acceptable for photos.
ort.env.wasm.numThreads = 1;

const CACHE_NAME = 'studio-models-v1';

const post = (msg: FromWorker, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

let app: { session: ort.InferenceSession; spec: ModelSpec; inputSize: number } | null = null;

async function fetchModel(spec: ModelSpec): Promise<ArrayBuffer> {
  const url = `${import.meta.env.BASE_URL}models/${spec.file}`;
  const cache = await caches.open(CACHE_NAME).catch(() => null); // Cache API can be unavailable (e.g. private mode)
  const cached = await cache?.match(url);
  if (cached) return cached.arrayBuffer();

  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`model download failed: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    post({ type: 'progress', modelId: spec.id, loaded, total });
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  await cache?.put(url, new Response(bytes)).catch(() => undefined); // caching is best-effort
  return bytes.buffer;
}

const createSession = (model: ArrayBuffer, backend: Backend) =>
  ort.InferenceSession.create(model, { executionProviders: [backend] });

async function createBestSession(model: ArrayBuffer): Promise<{ session: ort.InferenceSession; backend: Backend }> {
  if ('gpu' in navigator) {
    try {
      return { session: await createSession(model, 'webgpu'), backend: 'webgpu' };
    } catch (err) {
      console.warn('WebGPU unavailable, falling back to WASM:', err);
    }
  }
  return { session: await createSession(model, 'wasm'), backend: 'wasm' };
}

async function run(session: ort.InferenceSession, data: Float32Array, size: number): Promise<Float32Array> {
  const input = new ort.Tensor('float32', data, [1, 3, size, size]);
  const outputs = await session.run({ [session.inputNames[0]]: input });
  return outputs[session.outputNames[0]].data as Float32Array; // U²-Netp: first output is the fused map (d0)
}

/** One untimed warm-up run (compiles GPU shaders), then the median of `runs` timed runs. */
async function medianRunMs(session: ort.InferenceSession, size: number, runs: number): Promise<number> {
  const input = new Float32Array(3 * size * size).fill(0.5);
  await run(session, input, size);
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    await run(session, input, size);
    samples.push(performance.now() - t);
  }
  return percentile(samples, 50);
}

/** Time both backends at their own input sizes and keep the faster one. CPU first: it is cheap to start. */
async function probeBackends(model: ArrayBuffer, spec: ModelSpec) {
  const wasm = await createSession(model, 'wasm');
  const wasmMs = await medianRunMs(wasm, spec.inputSize.wasm, 2);
  let gpu: ort.InferenceSession;
  try {
    gpu = await createSession(model, 'webgpu');
  } catch (err) {
    console.warn('WebGPU unavailable, using WASM:', err);
    return { session: wasm, backend: 'wasm' as Backend, probe: { webgpuMs: null, wasmMs } };
  }
  const webgpuMs = await medianRunMs(gpu, spec.inputSize.webgpu, 3);
  const backend = pickBackend(webgpuMs, wasmMs);
  await (backend === 'webgpu' ? wasm : gpu).release();
  return { session: backend === 'webgpu' ? gpu : wasm, backend, probe: { webgpuMs, wasmMs } };
}

async function init(modelId: ModelId, preferred?: Backend) {
  const t0 = performance.now();
  const spec = MODELS[modelId];
  const model = await fetchModel(spec);
  let chosen: { session: ort.InferenceSession; backend: Backend; probe?: Probe };
  if (!('gpu' in navigator) || preferred === 'wasm') {
    chosen = { session: await createSession(model, 'wasm'), backend: 'wasm' };
  } else if (preferred === 'webgpu') {
    chosen = await createBestSession(model); // still falls back if the GPU stopped working
  } else {
    chosen = await probeBackends(model, spec);
  }
  const inputSize = spec.inputSize[chosen.backend];
  if (!chosen.probe) {
    // Warm-up run at the size we'll use: compiles GPU shaders so the first photo isn't slow.
    await run(chosen.session, new Float32Array(3 * inputSize * inputSize), inputSize);
  }
  app = { session: chosen.session, spec, inputSize };
  post({ type: 'ready', modelId, backend: chosen.backend, loadMs: performance.now() - t0, inputSize, probe: chosen.probe });
}

async function segment(id: number, bitmap: ImageBitmap) {
  if (!app) throw new Error('model not loaded');
  const { session, spec, inputSize } = app;
  const canvas = new OffscreenCanvas(inputSize, inputSize);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable in worker');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, inputSize, inputSize);
  const { data } = ctx.getImageData(0, 0, inputSize, inputSize);

  const t0 = performance.now();
  const toTensor = spec.contract === 'unit' ? toUnitTensor : toRembgTensor;
  const pred = await run(session, toTensor(data, inputSize, inputSize), inputSize);
  const inferMs = performance.now() - t0;

  const alpha = spec.contract === 'unit' ? probToAlpha(pred) : toAlpha(pred);
  post({ type: 'result', id, alpha, size: inputSize, inferMs }, [alpha.buffer]);
}

async function bench(modelId: ModelId, backend: Backend, runs: number) {
  const spec = MODELS[modelId];
  const model = await fetchModel(spec);
  const size = spec.inputSize[backend];
  const input = new Float32Array(3 * size * size).fill(0.5);

  let t = performance.now();
  const session = await createSession(model, backend);
  const createMs = performance.now() - t;
  try {
    t = performance.now();
    await run(session, input, size);
    const firstMs = performance.now() - t;
    const samples: number[] = [];
    for (let i = 0; i < runs; i++) {
      t = performance.now();
      await run(session, input, size);
      samples.push(performance.now() - t);
    }
    post({
      type: 'bench',
      result: { modelId, backend, inputSize: size, createMs, firstMs, medianMs: percentile(samples, 50), p90Ms: percentile(samples, 90), runs },
    });
  } finally {
    await session.release(); // free GPU memory before the next model
  }
}

async function handle(msg: ToWorker) {
  try {
    if (msg.type === 'init') await init(msg.modelId, msg.preferred);
    else if (msg.type === 'segment') await segment(msg.id, msg.bitmap);
    else await bench(msg.modelId, msg.backend, msg.runs);
  } catch (err) {
    post({ type: 'error', id: msg.type === 'segment' ? msg.id : undefined, context: msg.type, message: String(err) });
  } finally {
    if (msg.type === 'segment') msg.bitmap.close();
  }
}

// One message at a time: an ORT session must not run twice at once, which would happen when a
// new drop sends frames while the previous run's last frame is still being segmented.
let queue = Promise.resolve();
self.onmessage = (e: MessageEvent<ToWorker>) => {
  queue = queue.then(() => handle(e.data));
};
