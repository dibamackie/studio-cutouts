// Promise-based wrapper around the segmentation worker, so many frames can be in flight in order.
import type { Backend, ModelSpec } from './models';
import type { FromWorker, Probe } from './protocol';

export interface Ready {
  backend: Backend;
  inputSize: number;
  loadMs: number;
  probe?: Probe;
}

export interface Mask {
  alpha: Uint8ClampedArray<ArrayBuffer>; // size × size, 0–255
  size: number;
  inferMs: number;
}

export interface Segmenter {
  ready: Promise<Ready>;
  /** Cut out one frame. The caller keeps ownership of `source`. */
  segment(source: ImageBitmap): Promise<Mask>;
}

export function createSegmenter(model: ModelSpec, preferred: Backend | undefined, onProgress: (loaded: number, total: number) => void): Segmenter {
  const worker = new Worker(new URL('./segment.worker.ts', import.meta.url), { type: 'module' });
  const pending = new Map<number, { resolve: (m: Mask) => void; reject: (e: Error) => void }>();
  let nextId = 0;
  let resolveReady!: (r: Ready) => void;
  let rejectReady!: (e: Error) => void;
  const ready = new Promise<Ready>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  let dead: Error | null = null; // once the worker crashes, fail fast instead of posting into the void
  const failAll = (err: Error) => {
    dead = err;
    rejectReady(err);
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  };

  worker.onmessage = (e: MessageEvent<FromWorker>) => {
    const msg = e.data;
    switch (msg.type) {
      case 'progress':
        onProgress(msg.loaded, msg.total);
        break;
      case 'ready':
        resolveReady({ backend: msg.backend, inputSize: msg.inputSize, loadMs: msg.loadMs, probe: msg.probe });
        break;
      case 'result':
        pending.get(msg.id)?.resolve({ alpha: msg.alpha, size: msg.size, inferMs: msg.inferMs });
        pending.delete(msg.id);
        break;
      case 'error':
        if (msg.context === 'segment' && msg.id !== undefined) {
          pending.get(msg.id)?.reject(new Error(msg.message));
          pending.delete(msg.id);
        } else {
          failAll(new Error(msg.message));
        }
        break;
    }
  };
  worker.onerror = (e) => failAll(new Error(e.message || 'the segmentation worker crashed'));
  worker.onmessageerror = () => failAll(new Error('a message from the segmentation worker could not be read'));
  worker.postMessage({ type: 'init', modelId: model.id, preferred });

  return {
    ready,
    async segment(source) {
      const { inputSize } = await ready;
      if (dead) throw dead;
      const forModel = await createImageBitmap(source, { resizeWidth: inputSize, resizeHeight: inputSize, resizeQuality: 'high' });
      const id = ++nextId;
      return new Promise<Mask>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try {
          worker.postMessage({ type: 'segment', id, bitmap: forModel }, [forModel]);
        } catch (err) {
          pending.delete(id);
          forModel.close();
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    },
  };
}
