// Messages between the UI thread and the segmentation worker.
import type { Backend, ModelId } from './models';

export type ToWorker =
  | { type: 'init'; modelId: ModelId; preferred?: Backend } // preferred: a backend an earlier probe picked on this device
  | { type: 'segment'; id: number; bitmap: ImageBitmap }
  | { type: 'bench'; modelId: ModelId; backend: Backend; runs: number };

/** Median ms per frame from the first-visit backend probe; webgpuMs is null when WebGPU failed to start. */
export interface Probe {
  webgpuMs: number | null;
  wasmMs: number;
}

export interface BenchResult {
  modelId: ModelId;
  backend: Backend;
  inputSize: number;
  createMs: number; // session creation (model already downloaded)
  firstMs: number; // first run: includes GPU shader compilation
  medianMs: number;
  p90Ms: number;
  runs: number;
}

export type FromWorker =
  | { type: 'progress'; modelId: ModelId; loaded: number; total: number }
  | { type: 'ready'; modelId: ModelId; backend: Backend; loadMs: number; inputSize: number; probe?: Probe }
  | { type: 'result'; id: number; alpha: Uint8ClampedArray<ArrayBuffer>; size: number; inferMs: number }
  | { type: 'bench'; result: BenchResult }
  | { type: 'error'; id?: number; context: 'init' | 'segment' | 'bench'; message: string };
