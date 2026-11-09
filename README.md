# Studio

**Live: [studio-cutouts.vercel.app](https://studio-cutouts.vercel.app)** · **[Benchmarks](https://studio-cutouts.vercel.app/bench.html)**

Product cutouts that never leave your device. Drop in a product photo and the browser removes the background with a neural network I trained, running on your GPU (WebGPU) or CPU (WebAssembly). Nothing is uploaded.

> **Status: milestone 3 of 6.** The app runs my own model (Studio v1), and a benchmark page compares it against U²-Netp on public test sets and times both on the visitor's device. Next: the studio scene, 360° spin viewer and social export. See [Roadmap](#roadmap).

## Results

Studio v1 is a 4.5M-parameter U-Net (9.1 MB fp16) trained for this project; see [training/](training/README.md). Scored on the full public test sets, at each image's own resolution:

| Model | Download | DIS-TE max F | IoU | MAE | DUTS-TE max F | IoU | MAE |
|---|---|---|---|---|---|---|---|
| U²-Netp @320 (baseline) | 4.6 MB | 0.637 | 0.392 | 0.147 | 0.852 | 0.739 | 0.053 |
| **Studio v1 @512** | 9.1 MB | **0.774** | **0.623** | **0.085** | **0.867** | **0.761** | 0.049 |

DIS-TE (2,000 images) is fine detail: chairs, bikes, plants, jewelry. DUTS-TE (5,019) is everyday photos. On DIS-TE, Studio v1 gets +0.14 max F and +0.23 IoU over the baseline.

In a standalone test in desktop Chrome (RTX 3070), Studio v1 took 13–19 ms per frame on WebGPU and about 200 ms on the single-thread CPU fallback (U²-Netp: about 1.2 s). The [benchmark page](https://studio-cutouts.vercel.app/bench.html) measures any device, phones included, and copies the results as JSON.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173 (benchmarks at /bench.html)
npm test         # unit tests for the pre/post-processing
npm run build    # static site in dist/, deployable to Vercel or any static host
```

Add `?model=u2netp` to the app's URL to compare against the baseline on your own photos.

## How it works

```
photo ──► main thread: decode (EXIF-aware), cap at 4096 px, resize to the model's input size
              │  ImageBitmap (transferred, zero-copy)
              ▼
         Web Worker: RGB/255 → ONNX Runtime Web (WebGPU at 512 px, else WASM at 384 px) → Studio v1 → alpha
              │  alpha bytes (transferred)
              ▼
         main thread: upscale mask, composite as alpha onto the full-resolution photo → PNG
```

- **Inference runs in a Web Worker**, so the page never freezes.
- **Models are cached with the Cache API** under versioned file names: the second visit loads without a network request.
- **WebGPU first, WASM fallback**, picked at load time; the page shows which backend and input size actually ran.
- **One input size per session.** Changing the input size makes WebGPU recompile its shaders (120–830 ms), so each backend gets a fixed size: 512 px on WebGPU (best quality, ~19 ms) and 384 px on the CPU (~200 ms instead of ~350 ms).
- **A warm-up run at load** compiles the shaders, so the inference time shown is the real per-photo cost.
- **Normalization and the sigmoid live inside the exported model**, so the browser code is just "RGB/255 in, alpha out". `src/models.ts` records each model's contract, which is how the U²-Netp baseline still runs side by side.

## Engineering notes

- **Multithreaded WASM hangs inside a Web Worker** (ONNX Runtime Web 1.31.1): session creation never resolves with `numThreads > 1`, for both the WebGPU and WASM backends. The worker pins one thread. With Studio v1 the CPU fallback is still ~200 ms per photo, and the site doesn't need cross-origin isolation headers (COOP/COEP), which keeps static hosting and embedding simple.
- **The runtime is bigger than the model.** ONNX Runtime's WebGPU build is 7.3 MB gzipped, versus 9.1 MB for the model (fp16). Loading the smaller WASM-only build when WebGPU is unavailable is a planned optimization.
- **Picking the input size by measurement:** on DIS-VD, max F rises from 0.732 at 320 px to 0.774 at 512 px, with no loss on DUTS-TE, so the GPU path runs at 512 px.

## Roadmap

1. ✅ Baseline: off-the-shelf U²-Netp running in the browser end to end
2. ✅ Training pipeline and synthetic data generator; first trained model. See [training/README.md](training/README.md)
3. ✅ Swap in my model; benchmark page with quality tables and an on-device speed test (phone numbers still to collect)
4. Studio scene (backdrops, contact shadow, reflection) and 360° spin viewer
5. Social export (9:16 clip) and embed snippet
6. Deploy, demo GIF, failure gallery

## Credits and licenses

- Code: MIT (see `LICENSE`).
- Studio v1 weights: trained on DUTS and DIS5K, so they are for research and demo use only. See `NOTICE`.
- Baseline model: [U²-Net / U²-Netp](https://github.com/xuebinqin/U-2-Net) by Xuebin Qin et al., Apache-2.0. ONNX export from [rembg](https://github.com/danielgatis/rembg).
- Inference: [ONNX Runtime Web](https://github.com/microsoft/onnxruntime), MIT.
