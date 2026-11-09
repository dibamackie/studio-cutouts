/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/webgpu';
import { toAlpha, toInputTensor } from './tensor';
import type { FromWorker, ToWorker } from './protocol';

const MODEL_URL = `${import.meta.env.BASE_URL}models/u2netp.onnx`;
const MODEL_SIZE = 320; // U²-Netp has a fixed 320×320 input
const CACHE_NAME = 'studio-models-v1';

// shortcut: multithreaded WASM hangs when ORT starts inside a Web Worker (verified on 1.31.1);
// single-thread costs ~1.2 s/frame on the CPU fallback. Revisit with ort.env.wasm.proxy in the benchmark milestone.
ort.env.wasm.numThreads = 1;

const post =(msg: FromWorker, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

let session: ort.InferenceSession | null = null;

async function fetchModel(url: string): Promise<ArrayBuffer> {
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
    post({ type: 'progress', loaded, total });
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

async function createSession(model: ArrayBuffer): Promise<'webgpu' | 'wasm'> {
  if ('gpu' in navigator) {
    try {
      session = await ort.InferenceSession.create(model, { executionProviders: ['webgpu'] });
      return 'webgpu';
    } catch (err) {
      console.warn('WebGPU unavailable, falling back to WASM:', err);
    }
  }
  session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
  return 'wasm';
}

async function init() {
  const t0 = performance.now();
  const model = await fetchModel(MODEL_URL);
  const backend = await createSession(model);
  // Warm-up run: the first call compiles GPU shaders, which would otherwise inflate the first inference time.
  const zeros = new ort.Tensor('float32', new Float32Array(3 * MODEL_SIZE * MODEL_SIZE), [1, 3, MODEL_SIZE, MODEL_SIZE]);
  await session!.run({ [session!.inputNames[0]]: zeros });
  post({ type: 'ready', backend, loadMs: performance.now() - t0 });
}

async function segment(id: number, bitmap: ImageBitmap) {
  if (!session) throw new Error('model not loaded');
  const canvas = new OffscreenCanvas(MODEL_SIZE, MODEL_SIZE);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable in worker');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, MODEL_SIZE, MODEL_SIZE);
  bitmap.close();
  const { data } = ctx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE);

  const t0 = performance.now();
  const input = new ort.Tensor('float32', toInputTensor(data, MODEL_SIZE, MODEL_SIZE), [1, 3, MODEL_SIZE, MODEL_SIZE]);
  const outputs = await session.run({ [session.inputNames[0]]: input });
  const pred = outputs[session.outputNames[0]].data as Float32Array; // first output is the fused side output (d0)
  const inferMs = performance.now() - t0;

  const alpha = toAlpha(pred);
  post({ type: 'result', id, alpha, size: MODEL_SIZE, inferMs }, [alpha.buffer]);
}

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  try {
    if (msg.type === 'init') await init();
    else await segment(msg.id, msg.bitmap);
  } catch (err) {
    post({ type: 'error', id: msg.type === 'segment' ? msg.id : undefined, message: String(err) });
  }
};
