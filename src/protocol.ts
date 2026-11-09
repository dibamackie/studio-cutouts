// Messages between the UI thread and the segmentation worker.
import type { Backend, ModelId } from './models';

export type ToWorker =
  | { type: 'init'; modelId: ModelId }
  | { type: 'segment'; id: number; bitmap: ImageBitmap }
  | { type: 'bench'; modelId: ModelId; backend: Backend; runs: number };

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
  | { type: 'ready'; modelId: ModelId; backend: Backend; loadMs: number; inputSize: number }
  | { type: 'result'; id: number; alpha: Uint8ClampedArray<ArrayBuffer>; size: number; inferMs: number }
  | { type: 'bench'; result: BenchResult }
  | { type: 'error'; id?: number; context: 'init' | 'segment' | 'bench'; message: string };
