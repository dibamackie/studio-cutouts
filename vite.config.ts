import { defineConfig } from 'vitest/config';
import { saveSamplePlugin } from './tools/save-sample-plugin';

export default defineConfig({
  plugins: [saveSamplePlugin()], // dev server only
  optimizeDeps: { exclude: ['onnxruntime-web'] }, // pre-bundling breaks its import.meta.url wasm lookup
  worker: { format: 'es' },
  build: {
    rollupOptions: { input: { main: 'index.html', bench: 'bench.html' } },
    chunkSizeWarningLimit: 800, // the one large chunk is Mediabunny (728 KB), loaded lazily on clip export
  },
  test: { environment: 'node' },
});
