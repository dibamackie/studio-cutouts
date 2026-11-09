import { defineConfig } from 'vitest/config';

export default defineConfig({
  optimizeDeps: { exclude: ['onnxruntime-web'] }, // pre-bundling breaks its import.meta.url wasm lookup
  worker: { format: 'es' },
  test: { environment: 'node' },
});
