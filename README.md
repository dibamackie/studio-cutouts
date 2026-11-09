# Studio

Product cutouts that never leave your device. Drop in a product photo and the browser removes the background with a neural network running on your GPU (WebGPU) or CPU (WebAssembly). Nothing is uploaded.

> **Status: milestone 1 of 6.** The pipeline runs end to end with an off-the-shelf baseline model (U²-Netp). The next milestones replace it with a model I train myself, then add the studio scene, 360° spin viewer and social export. See [Roadmap](#roadmap).

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests for the pre/post-processing
npm run build    # static site in dist/, deployable to Vercel or any static host
```

## How it works

```
photo ──► main thread: decode (EXIF-aware), cap at 4096 px, resize to 320×320
              │  ImageBitmap (transferred, zero-copy)
              ▼
         Web Worker: normalize → ONNX Runtime Web (WebGPU, else WASM) → U²-Netp → 320×320 saliency map
              │  alpha bytes (transferred)
              ▼
         main thread: upscale mask, composite as alpha onto the full-resolution photo → PNG
```

- **Inference runs in a Web Worker**, so the page never freezes.
- **The model is cached with the Cache API**: the second visit loads it without a network request.
- **WebGPU first, WASM fallback**, picked at load time; the page shows which backend actually ran.
- **A warm-up run at load** compiles the GPU shaders, so the inference time shown is the real per-photo cost.

## Measurements so far (baseline model)

Desktop Chrome, production build, 1280×850 photo:

| | |
|---|---|
| Model download | 4.4 MB (U²-Netp ONNX, fp32) |
| Runtime download | 28.7 MB WASM (7.3 MB gzipped): ONNX Runtime's WebGPU build |
| Load (download from cache + session + warm-up) | ~0.8–1.6 s |
| Inference, WebGPU | ~57 ms (warm) |
| Inference, WASM single-thread | ~1.2 s (measured in a worker) |

Phone numbers come with the benchmark milestone.

## Engineering notes

- **Multithreaded WASM hangs inside a Web Worker** (ONNX Runtime Web 1.31.1): session creation never resolves with `numThreads > 1`, for both the WebGPU and WASM backends. The worker pins one thread for now, which costs the CPU fallback speed. Because threads aren't used, the site doesn't need cross-origin isolation headers (COOP/COEP), which keeps static hosting and embedding simple.
- **The runtime is bigger than the model.** ONNX Runtime's WebGPU build is 7.3 MB gzipped, versus 4.4 MB for the model. Loading the smaller WASM-only build when WebGPU is unavailable is a planned optimization.

## Roadmap

1. ✅ Baseline: off-the-shelf U²-Netp running in the browser end to end
2. Training pipeline and synthetic data generator; first trained model
3. Swap in my model; benchmark page (quality, size, latency on desktop and phone)
4. Studio scene (backdrops, contact shadow, reflection) and 360° spin viewer
5. Social export (9:16 clip) and embed snippet
6. Deploy, demo GIF, failure gallery

## Credits and licenses

- Code: MIT (see `LICENSE`).
- Baseline model: [U²-Net / U²-Netp](https://github.com/xuebinqin/U-2-Net) by Xuebin Qin et al., Apache-2.0. ONNX export from [rembg](https://github.com/danielgatis/rembg). See `NOTICE`.
- Inference: [ONNX Runtime Web](https://github.com/microsoft/onnxruntime), MIT.
