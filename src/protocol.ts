// Messages between the UI thread and the segmentation worker.

export type ToWorker = { type: 'init' } | { type: 'segment'; id: number; bitmap: ImageBitmap };

export type FromWorker =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready'; backend: 'webgpu' | 'wasm'; loadMs: number }
  | { type: 'result'; id: number; alpha: Uint8ClampedArray<ArrayBuffer>; size: number; inferMs: number }
  | { type: 'error'; id?: number; message: string };
