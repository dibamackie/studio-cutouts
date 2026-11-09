import { defineConfig } from 'vitest/config';
import { saveSamplePlugin } from './tools/save-sample-plugin';

export default defineConfig({
  plugins: [saveSamplePlugin()], // dev server only
  optimizeDeps: { exclude: ['onnxruntime-web'] }, // pre-bundling breaks its import.meta.url wasm lookup
  worker: { format: 'es' },
  build: { rollupOptions: { input: { main: 'index.html', bench: 'bench.html' } } },
  test: { environment: 'node' },
});
