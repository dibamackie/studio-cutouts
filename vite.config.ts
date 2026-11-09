import { defineConfig } from 'vitest/config';

export default defineConfig({
  optimizeDeps: { exclude: ['onnxruntime-web'] }, // pre-bundling breaks its import.meta.url wasm lookup
  worker: { format: 'es' },
  build: { rollupOptions: { input: { main: 'index.html', bench: 'bench.html' } } },
  test: { environment: 'node' },
});
