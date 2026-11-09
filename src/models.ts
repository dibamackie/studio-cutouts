// The models the app can run, and each one's input/output contract.

export type Backend = 'webgpu' | 'wasm';
export type ModelId = 'studio-v1' | 'u2netp';

export interface ModelSpec {
  id: ModelId;
  label: string;
  file: string; // under public/models; versioned names, so they can be cached forever
  megabytes: number;
  /** One input size per backend: changing size recompiles GPU shaders (120–830 ms). */
  inputSize: Record<Backend, number>;
  /** 'unit': RGB/255 in, alpha out. 'rembg': max-scaled + ImageNet-normalized in, min-max stretched out. */
  contract: 'unit' | 'rembg';
}

export const MODELS: Record<ModelId, ModelSpec> = {
  'studio-v1': {
    id: 'studio-v1',
    label: 'Studio v1',
    file: 'studio-v1.fp16.onnx',
    megabytes: 9.1,
    inputSize: { webgpu: 512, wasm: 384 }, // 512 scores best on DIS-VD; 384 keeps the CPU path near 200 ms
    contract: 'unit',
  },
  u2netp: {
    id: 'u2netp',
    label: 'U²-Netp (baseline)',
    file: 'u2netp.onnx',
    megabytes: 4.6,
    inputSize: { webgpu: 320, wasm: 320 }, // fixed by the exported graph
    contract: 'rembg',
  },
};

export const DEFAULT_MODEL: ModelId = 'studio-v1';

/**
 * WebGPU runs the larger, sharper input size, so keep it unless the CPU is clearly faster.
 * Measured on an Android phone with an Imagination D-Series GPU: WebGPU 510 ms vs WASM 183 ms.
 */
export const CPU_WIN_RATIO = 0.8;

export function pickBackend(webgpuMs: number | null, wasmMs: number): Backend {
  return webgpuMs !== null && webgpuMs * CPU_WIN_RATIO <= wasmMs ? 'webgpu' : 'wasm';
}

export function isModelId(value: unknown): value is ModelId {
  return typeof value === 'string' && Object.hasOwn(MODELS, value);
}
